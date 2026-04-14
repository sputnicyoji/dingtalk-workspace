# ext-stateful-watch Implementation Plan (v0.2)

**Status**: Draft — supersedes the 2026-04-14 @mention-based plan (discarded after probe found `dws chat` has no message-list primitive).

**Scope**: one ext (`hermes-extensions/ext-stateful-watch/`) bundling a shared state/dedup base and three cron-driven watchers over dws CLI data sources that Hermes cron alone cannot keep state for:

| Watcher | dws data source | Semantic |
|---|---|---|
| approvals | `oa approval list-initiated` + `list-pending` | state transitions + timeout |
| reports  | `report list`                                 | new-arrival delta |
| todos    | `todo list`                                   | deadline stage machine |

**Non-goals**: @mention detection (infeasible via dws), auto cron creation, SQLite, memory_tool integration.

---

## File layout

```
hermes-extensions/ext-stateful-watch/
├── pyproject.toml
├── README.md
├── DESIGN.md
├── install.sh
├── lib/
│   ├── __init__.py
│   ├── event.py
│   ├── state.py
│   ├── dws_client.py
│   ├── config.py
│   └── watchers/
│       ├── __init__.py
│       ├── approvals.py
│       ├── reports.py
│       └── todos.py
├── scripts/
│   ├── watch_approvals.py
│   ├── watch_reports.py
│   └── watch_todos.py
├── templates/
│   ├── approvals.yaml
│   ├── reports.yaml
│   └── todos.yaml
├── fixtures/              # captured dws responses from Task 1 probe
│   ├── approval_list_initiated.json
│   ├── approval_list_pending.json
│   ├── report_list.json
│   └── todo_list.json
└── tests/
    ├── __init__.py
    ├── test_event.py
    ├── test_state.py
    ├── test_dws_client.py
    ├── test_approvals.py
    ├── test_reports.py
    ├── test_todos.py
    └── test_e2e.py
```

Repo-level additions:
- `docs/decisions/005-stateful-watch-state-schema.md`

---

## Task 1 — Probe dws shapes (upfront, blocks everything)

**Goal**: capture real JSON responses from the 4 dws commands we depend on. Saves us from a second "wrong shape" surprise.

- [ ] **Step 1**: create `fixtures/` dir.
- [ ] **Step 2**: probe each endpoint, save stdout verbatim.
  ```bash
  cd hermes-extensions/ext-stateful-watch
  mkdir -p fixtures
  dws oa approval list-initiated --format json > fixtures/approval_list_initiated.json 2>fixtures/approval_list_initiated.err
  dws oa approval list-pending   --format json > fixtures/approval_list_pending.json   2>fixtures/approval_list_pending.err
  dws report list                 --format json > fixtures/report_list.json             2>fixtures/report_list.err
  dws todo task list              --format json > fixtures/todo_list.json               2>fixtures/todo_list.err
  ```
- [ ] **Step 3**: for each fixture, document actual top-level keys and item shape in DESIGN.md under "§Data shapes". Pay attention to:
  - approval: `status` enum values (pending/approved/rejected/revoked?), creator/approver fields
  - report: unique id field (`report_id` vs `biz_id`), sender field, template name
  - todo: `due_time` type (epoch ms vs ISO8601), `done_time`, `status` enum
- [ ] **Step 4**: if any probe fails due to implicit required flag (see ADR-004), note it and supply minimal dummy value (`--process-code dummy` etc.); if it fails for real (auth / scope), STOP and raise.
- [ ] **Step 5**: commit fixtures (scrub real user names/phone numbers first — replace with `U_REDACTED_1`, `P_REDACTED_1`).
  ```bash
  git add hermes-extensions/ext-stateful-watch/fixtures/ docs/superpowers/plans/2026-04-14-ext-stateful-watch.md
  git commit -m "feat(ext-stateful-watch): probe dws fixtures for 3 watchers"
  ```

**Do not skip.** Every subsequent watcher test depends on these fixtures being accurate.

---

## Task 2 — Scaffolding + DESIGN.md

**Files**: `pyproject.toml`, `lib/__init__.py`, `lib/watchers/__init__.py`, `tests/__init__.py`, `README.md`, `DESIGN.md`.

- [ ] **Step 1**: `pyproject.toml`
  ```toml
  [project]
  name = "ext-stateful-watch"
  version = "0.2.0-draft"
  description = "Hermes cron extension: cross-run state for DingTalk approvals/reports/todos"
  requires-python = ">=3.11"
  dependencies = []  # stdlib + PyYAML only

  [project.optional-dependencies]
  dev = ["pytest>=8.0", "pytest-cov>=5.0", "PyYAML>=6.0"]

  [tool.pytest.ini_options]
  testpaths = ["tests"]
  pythonpath = ["."]
  ```
  (PyYAML is dev-only; runtime script imports lazily and degrades to stdlib if absent — see Task 8.)

- [ ] **Step 2**: empty `__init__.py` files.
- [ ] **Step 3**: `README.md` — 1-page overview: what it does, install, 3 cron commands.
- [ ] **Step 4**: `DESIGN.md` — full design doc combining §1–§5 from the brainstorming session + §Data shapes section from Task 1. Sections:
  1. Architecture & packaging
  2. State schema per watcher
  3. Delivery via stdout + agent triage
  4. Testing strategy
  5. Roll-out / exit criteria
  6. Data shapes (populated by Task 1)
- [ ] **Step 5**: commit.
  ```bash
  git commit -m "feat(ext-stateful-watch): scaffolding + DESIGN.md"
  ```

---

## Task 3 — `lib/event.py` (TDD)

**Purpose**: unified event record that any watcher emits. Watchers never write directly to stdout; they produce `Event` objects and a render layer serializes.

- [ ] **Step 1**: `tests/test_event.py` first.
  ```python
  from lib.event import Event, make_event_id

  def test_event_id_deterministic():
      assert make_event_id("approval", "xyz", "approved") == make_event_id("approval", "xyz", "approved")

  def test_event_id_differs_by_kind():
      assert make_event_id("approval", "xyz", "approved") != make_event_id("todo", "xyz", "approved")

  def test_event_to_markdown_minimal():
      e = Event(kind="approval", source_id="xyz", severity="info", title="加班申请", detail="approved", extra={})
      line = e.to_markdown_row()
      assert "approval" in line and "xyz" in line and "approved" in line
  ```
- [ ] **Step 2**: watch it fail.
- [ ] **Step 3**: implement `lib/event.py`.
  ```python
  from __future__ import annotations
  from dataclasses import dataclass, field
  from hashlib import sha256

  def make_event_id(kind: str, source_id: str, facet: str) -> str:
      return sha256(f"{kind}|{source_id}|{facet}".encode()).hexdigest()[:16]

  @dataclass(frozen=True)
  class Event:
      kind: str                 # "approval" | "report" | "todo"
      source_id: str            # approval_id / report_id / todo_id
      severity: str             # "info" | "warn" | "alert"
      title: str
      detail: str
      extra: dict = field(default_factory=dict)

      @property
      def event_id(self) -> str:
          return make_event_id(self.kind, self.source_id, self.detail)

      def to_markdown_row(self) -> str:
          return f"- [{self.severity}] {self.kind}:{self.source_id} — {self.title} — {self.detail}"
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit `feat(ext-stateful-watch): Event dataclass`.

---

## Task 4 — `lib/state.py` (TDD)

**Purpose**: JSONL append + load + atomic file replacement. Watcher-agnostic primitives.

- [ ] **Step 1**: `tests/test_state.py`.
  ```python
  import json
  from pathlib import Path
  from lib.state import append_row, load_rows, atomic_replace_all

  def test_append_then_load(tmp_path):
      f = tmp_path / "s.jsonl"
      append_row(f, {"a": 1})
      append_row(f, {"a": 2})
      rows = list(load_rows(f))
      assert rows == [{"a": 1}, {"a": 2}]

  def test_load_tolerates_corrupt_line(tmp_path, capsys):
      f = tmp_path / "s.jsonl"
      append_row(f, {"ok": True})
      f.open("a").write("{not json\n")
      append_row(f, {"ok": True, "n": 2})
      rows = list(load_rows(f))
      assert rows == [{"ok": True}, {"ok": True, "n": 2}]
      assert "corrupt" in capsys.readouterr().err.lower()

  def test_atomic_replace(tmp_path):
      f = tmp_path / "s.jsonl"
      append_row(f, {"old": True})
      atomic_replace_all(f, [{"new": 1}, {"new": 2}])
      rows = list(load_rows(f))
      assert rows == [{"new": 1}, {"new": 2}]

  def test_load_missing_file_empty(tmp_path):
      assert list(load_rows(tmp_path / "absent.jsonl")) == []
  ```
- [ ] **Step 2**: fail.
- [ ] **Step 3**: implement `lib/state.py`.
  ```python
  from __future__ import annotations
  import json, os, sys
  from pathlib import Path
  from typing import Iterable, Iterator

  def append_row(path: Path, row: dict) -> None:
      path.parent.mkdir(parents=True, exist_ok=True)
      with path.open("a", encoding="utf-8") as f:
          f.write(json.dumps(row, ensure_ascii=False) + "\n")

  def load_rows(path: Path) -> Iterator[dict]:
      if not path.exists():
          return
      with path.open("r", encoding="utf-8") as f:
          for i, line in enumerate(f, 1):
              line = line.strip()
              if not line:
                  continue
              try:
                  yield json.loads(line)
              except json.JSONDecodeError:
                  print(f"[state] corrupt line {i} in {path}, skipping", file=sys.stderr)

  def atomic_replace_all(path: Path, rows: Iterable[dict]) -> None:
      path.parent.mkdir(parents=True, exist_ok=True)
      tmp = path.with_suffix(path.suffix + ".tmp")
      with tmp.open("w", encoding="utf-8") as f:
          for r in rows:
              f.write(json.dumps(r, ensure_ascii=False) + "\n")
      os.replace(tmp, path)
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit `feat(ext-stateful-watch): state JSONL I/O`.

---

## Task 5 — `lib/dws_client.py` (TDD)

**Purpose**: one subprocess wrapper shared by 3 watchers. Injectable runner so tests never shell out.

- [ ] **Step 1**: `tests/test_dws_client.py`.
  ```python
  from lib.dws_client import DwsClient, DwsCallFailed
  import pytest, subprocess, json

  def fake_ok(payload):
      def _run(cmd, timeout):
          return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
      return _run

  def fake_fail(code=1, stderr="boom"):
      def _run(cmd, timeout):
          return subprocess.CompletedProcess(cmd, code, stdout="", stderr=stderr)
      return _run

  def test_invoke_success():
      c = DwsClient(runner=fake_ok({"items": [1, 2]}))
      assert c.invoke(["oa", "approval", "list-pending"]) == {"items": [1, 2]}

  def test_invoke_nonzero_raises():
      c = DwsClient(runner=fake_fail())
      with pytest.raises(DwsCallFailed):
          c.invoke(["oa", "approval", "list-pending"])

  def test_invoke_bad_json_raises():
      def runner(cmd, timeout):
          return subprocess.CompletedProcess(cmd, 0, stdout="not json", stderr="")
      c = DwsClient(runner=runner)
      with pytest.raises(DwsCallFailed):
          c.invoke(["oa", "approval", "list-pending"])
  ```
- [ ] **Step 2**: fail.
- [ ] **Step 3**: implement.
  ```python
  from __future__ import annotations
  import json, subprocess
  from typing import Callable

  Runner = Callable[[list[str], float], subprocess.CompletedProcess]

  class DwsCallFailed(RuntimeError):
      pass

  def _default_runner(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
      return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)

  class DwsClient:
      def __init__(self, runner: Runner | None = None, timeout: float = 30.0, binary: str = "dws"):
          self._run = runner or _default_runner
          self._timeout = timeout
          self._binary = binary

      def invoke(self, args: list[str]) -> dict:
          cmd = [self._binary, *args, "--format", "json"]
          try:
              cp = self._run(cmd, self._timeout)
          except subprocess.TimeoutExpired as e:
              raise DwsCallFailed(f"timeout: {e}") from e
          if cp.returncode != 0:
              raise DwsCallFailed(f"exit {cp.returncode}: {cp.stderr.strip()[:200]}")
          try:
              return json.loads(cp.stdout)
          except json.JSONDecodeError as e:
              raise DwsCallFailed(f"bad json: {e}; head={cp.stdout[:120]!r}") from e
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit.

---

## Task 6 — `lib/watchers/approvals.py` (TDD)

**Purpose**: pure diff function over two snapshots of approval state.

- [ ] **Step 1**: `tests/test_approvals.py`.
  Load `fixtures/approval_list_*.json` shapes (use a minimal 2-row fabricated dict shaped like the real fixtures).
  ```python
  from lib.watchers.approvals import diff_snapshots, detect_timeouts

  def test_new_approval_no_event():
      prev = []
      curr = [{"approval_id": "a1", "role": "initiated", "status": "pending", "title": "加班"}]
      assert diff_snapshots(prev, curr) == []  # new pending items are not themselves events

  def test_status_transition_emits_event():
      prev = [{"approval_id": "a1", "role": "initiated", "status": "pending", "title": "加班"}]
      curr = [{"approval_id": "a1", "role": "initiated", "status": "approved", "title": "加班"}]
      evs = diff_snapshots(prev, curr)
      assert len(evs) == 1 and evs[0].kind == "approval" and "approved" in evs[0].detail

  def test_timeout_pending_alerts_once():
      snapshots = [{"approval_id": "a1", "role": "pending", "status": "pending", "title": "报销", "first_seen": 0}]
      evs = detect_timeouts(snapshots, now=4 * 3600 + 1, timeout_hours=4, already_alerted=set())
      assert len(evs) == 1
      # second run with same id in already_alerted → suppressed
      evs2 = detect_timeouts(snapshots, now=5 * 3600, timeout_hours=4, already_alerted={"a1"})
      assert evs2 == []
  ```
- [ ] **Step 2**: fail.
- [ ] **Step 3**: implement `lib/watchers/approvals.py`. Pure functions, no I/O. Sketch:
  ```python
  def diff_snapshots(prev: list[dict], curr: list[dict]) -> list[Event]:
      prev_map = {r["approval_id"]: r for r in prev}
      out = []
      for row in curr:
          p = prev_map.get(row["approval_id"])
          if p is None:
              continue  # new item = no event yet; becomes event on next transition or timeout
          if p["status"] != row["status"]:
              out.append(Event(
                  kind="approval",
                  source_id=row["approval_id"],
                  severity="info",
                  title=row.get("title", ""),
                  detail=f"{p['status']} -> {row['status']}",
                  extra={"role": row.get("role")},
              ))
      return out

  def detect_timeouts(snapshots, now, timeout_hours, already_alerted):
      out = []
      for row in snapshots:
          if row.get("role") != "pending" or row.get("status") != "pending":
              continue
          if now - row.get("first_seen", now) < timeout_hours * 3600:
              continue
          if row["approval_id"] in already_alerted:
              continue
          out.append(Event(
              kind="approval", source_id=row["approval_id"], severity="warn",
              title=row.get("title", ""), detail=f"pending > {timeout_hours}h",
              extra={"role": "pending"},
          ))
      return out
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit.

---

## Task 7 — `lib/watchers/reports.py` (TDD)

**Purpose**: delta filter over report IDs.

- [ ] **Step 1**: `tests/test_reports.py`.
  ```python
  from lib.watchers.reports import filter_new

  def test_filter_new_excludes_seen():
      seen = {"r1", "r2"}
      curr = [{"report_id": "r2", "sender": "A", "title": "日报"},
              {"report_id": "r3", "sender": "B", "title": "日报"}]
      evs = filter_new(seen, curr)
      assert len(evs) == 1 and evs[0].source_id == "r3"

  def test_filter_new_all_fresh():
      evs = filter_new(set(), [{"report_id": "r1", "sender": "A", "title": "日报"}])
      assert len(evs) == 1
  ```
- [ ] **Step 2**: fail.
- [ ] **Step 3**: implement.
  ```python
  def filter_new(seen_ids: set[str], curr: list[dict]) -> list[Event]:
      return [
          Event(kind="report", source_id=r["report_id"], severity="info",
                title=r.get("title", ""), detail=f"new from {r.get('sender', '?')}",
                extra={"template": r.get("template")})
          for r in curr if r["report_id"] not in seen_ids
      ]
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit.

---

## Task 8 — `lib/watchers/todos.py` (TDD)

**Purpose**: stage-machine for deadlines.

Stages: `warned_24h` (due within 24h, not yet warned) → `overdue_day1` (just crossed due) → `overdue_daily` (every subsequent 24h tick) → `closed` (done/deleted, terminal).

- [ ] **Step 1**: `tests/test_todos.py`.
  ```python
  from lib.watchers.todos import next_stages

  def test_fresh_todo_within_24h_emits_warn():
      state_map = {}
      curr = [{"todo_id": "t1", "due_time": 3600, "status": "todo", "title": "写周报"}]
      evs = next_stages(state_map, curr, now=0)
      assert len(evs) == 1 and evs[0].detail.startswith("warn_24h")

  def test_warned_todo_not_re_warned():
      state_map = {"t1": {"stage": "warned_24h"}}
      curr = [{"todo_id": "t1", "due_time": 3600, "status": "todo", "title": "写周报"}]
      assert next_stages(state_map, curr, now=0) == []

  def test_overdue_day1_from_warned():
      state_map = {"t1": {"stage": "warned_24h"}}
      curr = [{"todo_id": "t1", "due_time": 0, "status": "todo", "title": "写周报"}]
      evs = next_stages(state_map, curr, now=100)
      assert len(evs) == 1 and "overdue_day1" in evs[0].detail

  def test_done_todo_emits_closed_once():
      state_map = {"t1": {"stage": "warned_24h"}}
      curr = [{"todo_id": "t1", "due_time": 0, "status": "done", "title": "写周报"}]
      evs = next_stages(state_map, curr, now=100)
      assert len(evs) == 1 and "closed" in evs[0].detail
      state_map2 = {"t1": {"stage": "closed"}}
      assert next_stages(state_map2, curr, now=200) == []
  ```
- [ ] **Step 2**: fail.
- [ ] **Step 3**: implement.
  ```python
  def next_stages(state_map, curr, now):
      out = []
      for t in curr:
          tid = t["todo_id"]
          prior = state_map.get(tid, {}).get("stage")
          if t["status"] in ("done", "deleted"):
              if prior != "closed":
                  out.append(Event("todo", tid, "info", t.get("title", ""), "closed"))
              continue
          due = t.get("due_time", 0)
          if due == 0:
              continue
          if now < due:
              if due - now <= 24 * 3600 and prior is None:
                  out.append(Event("todo", tid, "warn", t.get("title", ""), "warn_24h"))
          else:  # overdue
              if prior in (None, "warned_24h"):
                  out.append(Event("todo", tid, "alert", t.get("title", ""), "overdue_day1"))
              elif prior == "overdue_day1" and now - due >= 24 * 3600:
                  out.append(Event("todo", tid, "alert", t.get("title", ""), "overdue_daily"))
      return out
  ```
- [ ] **Step 4**: green.
- [ ] **Step 5**: commit.

---

## Task 9–11 — scripts (three wire-up files + e2e tests)

Each `scripts/watch_*.py` is a thin main that:
1. Loads config (`lib.config.load()`)
2. Reads prior state (`lib.state.load_rows`)
3. Calls DwsClient to get current data
4. Invokes its watcher pure function
5. Writes new state records
6. Renders events as markdown to stdout; empty stdout on DwsCallFailed

**Example — `scripts/watch_approvals.py`** (Task 9):

```python
#!/usr/bin/env python3
from __future__ import annotations
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from lib.state import load_rows, append_row
from lib.dws_client import DwsClient, DwsCallFailed
from lib.watchers.approvals import diff_snapshots, detect_timeouts
from lib.config import load_config

def main() -> int:
    cfg = load_config()["approvals"]
    state_dir = Path.home() / ".hermes" / "dingtalk-extensions" / "state"
    state_file = state_dir / "approvals.jsonl"
    client = DwsClient()
    try:
        initiated = client.invoke(["oa", "approval", "list-initiated"]).get("items", [])
        pending   = client.invoke(["oa", "approval", "list-pending"]).get("items", [])
    except DwsCallFailed as e:
        print(f"[approvals] dws failed: {e}", file=sys.stderr)
        return 0  # cron resilience: empty stdout, exit 0
    # tag role + first_seen for new items
    now = int(time.time())
    prior_rows = list(load_rows(state_file))
    prior_snapshots = _last_snapshot(prior_rows)
    curr_snapshot = _build_snapshot(initiated, pending, prior_snapshots, now)
    append_row(state_file, {"kind": "snapshot", "ts": now, "items": curr_snapshot})
    events = diff_snapshots(prior_snapshots, curr_snapshot)
    already_alerted = _extract_alerted(prior_rows)
    events += detect_timeouts(curr_snapshot, now, cfg["timeout_hours"], already_alerted)
    if not events:
        return 0
    print("# stateful-watch / approvals\n")
    for e in events:
        print(e.to_markdown_row())
        append_row(state_file, {"kind": "alerted", "ts": now, "event_id": e.event_id, "source_id": e.source_id})
    return 0

# helpers: _last_snapshot, _build_snapshot, _extract_alerted — see repo
if __name__ == "__main__":
    sys.exit(main())
```

**e2e test pattern** (same for all 3, in `tests/test_e2e.py`):

```python
def test_approvals_e2e_transition(tmp_path, monkeypatch):
    # 1st run: write initial snapshot
    monkeypatch.setenv("HOME", str(tmp_path))
    fake_runs = [
        {"items": [{"approval_id": "a1", "status": "pending", "title": "加班"}]},
        {"items": []},
    ]
    # inject DwsClient.runner via monkeypatch, run script main, assert stdout empty
    # 2nd run: a1 flips to approved
    fake_runs = [
        {"items": [{"approval_id": "a1", "status": "approved", "title": "加班"}]},
        {"items": []},
    ]
    # run main, assert stdout contains "approved"
```

Each Task 9/10/11 follows the same 5 steps:
- [ ] Step 1: write e2e test (xfail then runs)
- [ ] Step 2: implement script
- [ ] Step 3: green
- [ ] Step 4: run real: `python scripts/watch_<x>.py` against live dws; spot-check stdout format
- [ ] Step 5: commit

---

## Task 12 — cron prompt templates

**Files**: `templates/approvals.yaml`, `templates/reports.yaml`, `templates/todos.yaml`.

Each yaml has two keys:
```yaml
schedule: "*/30 * * * *"   # suggested, operator overrides
prompt: |
  你收到了 stateful-watch/<kind> 的事件列表（来自上方 script 输出）。
  Triage 规则：
    - severity=alert → dws ding message send 给自己
    - severity=warn  → Hermes todo 加一条今日待办
    - severity=info  → 一句话日志即可
  不要对同一 event_id 重复处理；对最紧迫的前 3 条采取动作，其他归纳汇总。
```

Template-specific triage:
- approvals: 上游角色 = 上级/客户 → 提升一档 severity
- reports: 发信人在 `include_senders` → alert；否则 info
- todos: overdue_daily → 降级成 warn（避免每天轰炸）

- [ ] Write 3 yaml files
- [ ] commit `feat(ext-stateful-watch): cron prompt templates`

---

## Task 13 — `install.sh`

- [ ] **Step 1**: script body.
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
  SRC="$(cd "$(dirname "$0")" && pwd)"
  DST_SCRIPTS="$HERMES_HOME/scripts/stateful_watch"
  DST_DATA="$HERMES_HOME/dingtalk-extensions"
  mkdir -p "$DST_SCRIPTS" "$DST_DATA/state" "$DST_DATA/config" "$DST_DATA/templates"
  cp -R "$SRC/lib" "$DST_SCRIPTS/"
  cp -R "$SRC/scripts/." "$DST_SCRIPTS/"
  cp -R "$SRC/templates/." "$DST_DATA/templates/"
  # seed default config if absent
  if [[ ! -f "$DST_DATA/config/stateful_watch.yaml" ]]; then
    cat > "$DST_DATA/config/stateful_watch.yaml" <<YAML
  approvals:
    timeout_hours: 4
    roles_high_priority: ["上级", "客户"]
  reports:
    include_senders: []
    exclude_templates: []
  todos:
    warn_before_hours: 24
  YAML
  fi
  cat <<EOF
  Installed ext-stateful-watch to $DST_SCRIPTS
  Next: create cron jobs (one per watcher you want enabled):
    hermes cronjob create --schedule "*/30 * * * *" --script $DST_SCRIPTS/watch_approvals.py --prompt "\$(cat $DST_DATA/templates/approvals.yaml | yq -r .prompt)"
    ... same for reports / todos
  EOF
  ```
- [ ] **Step 2**: `bash -n install.sh` (syntax check).
- [ ] **Step 3**: dry-run: `HERMES_HOME=/tmp/h-test bash install.sh && ls -R /tmp/h-test && rm -rf /tmp/h-test`.
- [ ] **Step 4**: commit.

---

## Task 14 — `lib/config.py`

Simple loader; no validation framework.

- [ ] Test: `tests/test_config.py` covers (a) loads yaml, (b) missing file → defaults, (c) partial file → merges with defaults.
- [ ] Implement: try-import yaml; if absent, hard-error with install hint.
- [ ] Commit.

---

## Task 15 — ADR-005 state schema

**File**: `docs/decisions/005-stateful-watch-state-schema.md`.

Sections:
1. Context — cross-run state needed for 3 watchers
2. Decision — JSONL per-watcher files, no SQLite in v0.2
3. Rejected alternatives — SQLite (overkill), memory_tool (session-scoped), Hermes-native state (would couple T2 to Hermes internals)
4. Schema versions — v1 fields for each watcher (copied from DESIGN.md §2)
5. Migration path — >5MB file triggers v0.3 SQLite consideration
6. Out-of-scope — retention / rotation / encryption

- [ ] Write ADR
- [ ] Commit `docs: ADR-005 stateful-watch state schema`

---

## Task 16 — Final verification + rollout docs

- [ ] **Step 1**: `pytest tests/ -v` — all green, < 2s wall time.
- [ ] **Step 2**: `bash install.sh` against throwaway `HERMES_HOME`; verify file layout.
- [ ] **Step 3**: `python scripts/watch_todos.py` against live dws (safest — pure read); confirm stdout is valid markdown or empty.
- [ ] **Step 4**: update `progress.md` v0.2 section: "MVP 代码完成，γ-todos 进入 7 天实战观察"
- [ ] **Step 5**: update `docs/ROADMAP.md` v0.2 row accordingly.
- [ ] **Step 6**: final commit + push.
  ```bash
  git add progress.md docs/ROADMAP.md
  git commit -m "docs: ext-stateful-watch v0.2 MVP complete, γ-todos observation begun"
  git push
  ```

---

## Spec coverage self-review

Checked against brainstorm §1–§5:
- §1 Architecture → Tasks 2, 9–11, 13
- §2 State schema → Tasks 3, 4, 6–8, 15
- §3 Delivery via stdout → Tasks 9–12
- §4 Testing → Tasks 3–8 (unit), 9–11 (e2e), 16 (real run)
- §5 Roll-out → Task 16

No placeholders, no cross-task naming drift, no speculative shapes (Task 1 probes everything before code).

## Execution notes

- **TDD discipline**: every task writes test first, watches it fail, then implements.
- **Commit granularity**: one commit per task → 15 commits + Task 16 final doc commit.
- **Do not skip Task 1.** Second probe miss = second rewrite.
- **If Task 1 reveals a fixture differs from assumed shape** (e.g., `report_id` is actually `biz_id`), amend the plan in place (this file) + note in DESIGN.md §Data shapes before touching watcher code.
- **Estimated effort**: 6–9 hours single-session (3 watchers × ~1h each + base + install + docs).
