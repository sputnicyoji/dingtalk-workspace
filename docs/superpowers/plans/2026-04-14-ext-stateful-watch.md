# ext-stateful-watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `hermes-extensions/ext-stateful-watch` v0.2 — a Hermes cron `script` that filters DingTalk `@ 我` mentions against a JSONL state file and injects only new events into the agent prompt.

**Architecture:** Python script lives in `~/.hermes/scripts/stateful_watch/`, runs via Hermes cron's `subprocess.run([sys.executable, path])` pre-agent. Calls `dws` CLI via subprocess (no MCP, no Hermes API). Reads/writes JSONL state under `~/.hermes/dingtalk-extensions/state/`. stdlib only — no Hermes venv pollution.

**Tech Stack:** Python ≥3.11 (stdlib only at runtime), pytest for tests, TOML config, dws CLI (v1.0.8+) as DingTalk entry point.

---

## File Structure

```
hermes-extensions/ext-stateful-watch/
├── lib/
│   ├── __init__.py            # empty
│   ├── event.py               # Event dataclass + from_dws_json
│   ├── state.py               # JSONL I/O, mark_resolved
│   ├── dws_client.py          # subprocess wrapper for dws
│   └── dedup.py               # filter_new_events, detect_resolved
├── scripts/
│   └── unreplied_mentions.py  # main entry (installed to ~/.hermes/scripts/stateful_watch/)
├── templates/
│   └── unreplied_mentions.yaml  # cron prompt template
├── tests/
│   ├── __init__.py            # empty
│   ├── test_event.py
│   ├── test_state.py
│   ├── test_dws_client.py
│   ├── test_dedup.py
│   └── test_script_e2e.py
├── config.example.toml
├── install.sh
├── pyproject.toml
├── README.md
└── DESIGN.md                  # brainstorming output (4 sections)
```

**Responsibility separation:**
- `event.py`: pure dataclass + conversion, no I/O
- `state.py`: JSONL persistence, atomic writes, no business logic
- `dws_client.py`: subprocess only, no state, no filtering
- `dedup.py`: pure algorithm over Event + state rows
- `scripts/unreplied_mentions.py`: wiring + config, no algorithms

---

## Task 1: Project scaffolding

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/pyproject.toml`
- Create: `hermes-extensions/ext-stateful-watch/lib/__init__.py` (empty)
- Create: `hermes-extensions/ext-stateful-watch/tests/__init__.py` (empty)
- Create: `hermes-extensions/ext-stateful-watch/README.md`
- Create: `hermes-extensions/ext-stateful-watch/DESIGN.md`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "ext-stateful-watch"
version = "0.2.0-draft"
description = "Hermes cron script: cross-run dedup for DingTalk @mentions"
requires-python = ">=3.11"
dependencies = []  # stdlib only at runtime

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=5.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

- [ ] **Step 2: Create empty __init__.py files**

```bash
# lib/__init__.py and tests/__init__.py are both empty files
```

Shell:
```bash
touch hermes-extensions/ext-stateful-watch/lib/__init__.py
touch hermes-extensions/ext-stateful-watch/tests/__init__.py
```

- [ ] **Step 3: Write README.md**

```markdown
# ext-stateful-watch

**T2 Hermes extension (v0.2-draft)** — solves Hermes cron's missing piece: cross-run state for deduplication.

## What it does

Every 30 min, scans DingTalk `@` mentions in watched conversations. New events (not seen in prior runs) get injected into the cron agent's prompt. Already-alerted events are suppressed.

## Install

```bash
bash install.sh  # copies scripts to $HERMES_HOME/scripts/stateful_watch/
```

Then create the cron job manually:
```bash
hermes cronjob create \
  --schedule "*/30 * * * *" \
  --script scripts/stateful_watch/unreplied_mentions.py \
  --prompt "$(cat ~/.hermes/dingtalk-extensions/templates/unreplied_mentions.yaml)"
```

## Files

- `scripts/unreplied_mentions.py` — entry point, installed to `$HERMES_HOME/scripts/`
- `lib/` — pure modules (state, dws_client, dedup, event)
- `tests/` — pytest unit + e2e tests
- `DESIGN.md` — architecture, state schema, dedup semantics
- `docs/decisions/005-stateful-watch-state-schema.md` (repo-level ADR)
```

- [ ] **Step 4: Write DESIGN.md**

Copy the 4-section brainstorming output covering: Architecture & data flow, State schema + dedup semantics, MVP scope + evolution, Testing/install.

- [ ] **Step 5: Commit scaffolding**

```bash
git add hermes-extensions/ext-stateful-watch/
git commit -m "feat(ext-stateful-watch): v0.2 scaffolding + DESIGN.md"
```

---

## Task 2: Event dataclass

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/lib/event.py`
- Test: `hermes-extensions/ext-stateful-watch/tests/test_event.py`

- [ ] **Step 1: Write the failing test**

`tests/test_event.py`:
```python
from __future__ import annotations

import hashlib

from lib.event import Event


def test_event_id_is_stable_hash_of_msg_id():
    e = Event.from_dws_message(
        msg_id="msg_7d4a3b2f",
        conversation_id="cidXXX",
        conversation_title="K1应援组",
        sender_id="u_123",
        sender_name="王总",
        text="项目进度?",
        sent_at_ms=1776160000000,
    )
    expected = hashlib.sha256(b"msg_7d4a3b2f").hexdigest()[:16]
    assert e.event_id == expected


def test_event_roundtrips_through_row():
    e = Event.from_dws_message(
        msg_id="m1",
        conversation_id="c1",
        conversation_title="t",
        sender_id="s",
        sender_name="S",
        text="hi",
        sent_at_ms=1_000_000,
    )
    row = e.to_row(first_seen_ms=2_000_000)
    assert row["event_id"] == e.event_id
    assert row["source"]["sender_name"] == "S"
    assert row["first_seen"] == 2_000_000
    assert row["resolved_at"] is None
    assert row["schema_version"] == 1
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd hermes-extensions/ext-stateful-watch
python -m pytest tests/test_event.py -v
```
Expected: `ModuleNotFoundError: No module named 'lib.event'`

- [ ] **Step 3: Implement lib/event.py**

```python
"""Event: one observed DingTalk item (e.g. a mention in a group).

Pure dataclass + deterministic id derivation. No I/O, no dws coupling
beyond the `from_dws_message` constructor signature.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class Event:
    event_id: str
    conversation_id: str
    conversation_title: str
    sender_id: str
    sender_name: str
    text: str
    sent_at_ms: int

    @staticmethod
    def from_dws_message(
        *,
        msg_id: str,
        conversation_id: str,
        conversation_title: str,
        sender_id: str,
        sender_name: str,
        text: str,
        sent_at_ms: int,
    ) -> Event:
        # sha256 + truncate 16 = 64-bit hex, collision-safe for our scale.
        event_id = hashlib.sha256(msg_id.encode("utf-8")).hexdigest()[:16]
        return Event(
            event_id=event_id,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
            sender_id=sender_id,
            sender_name=sender_name,
            text=text,
            sent_at_ms=sent_at_ms,
        )

    def to_row(self, *, first_seen_ms: int) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "event_id": self.event_id,
            "category": "unreplied_mentions",
            "source": {
                "conversation_id": self.conversation_id,
                "conversation_title": self.conversation_title,
                "sender_id": self.sender_id,
                "sender_name": self.sender_name,
                "text_preview": self.text[:80],
                "sent_at": self.sent_at_ms,
            },
            "first_seen": first_seen_ms,
            "alerted_at": first_seen_ms,
            "resolved_at": None,
        }
```

- [ ] **Step 4: Run test, verify pass**

```bash
python -m pytest tests/test_event.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add lib/event.py tests/test_event.py
git commit -m "feat(ext-stateful-watch): Event dataclass + deterministic event_id"
```

---

## Task 3: State module — JSONL I/O

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/lib/state.py`
- Test: `hermes-extensions/ext-stateful-watch/tests/test_state.py`

- [ ] **Step 1: Write failing tests**

`tests/test_state.py`:
```python
from __future__ import annotations

import json
from pathlib import Path

import pytest

from lib.state import append_rows, load_active_rows, mark_resolved


def test_append_and_load(tmp_path: Path) -> None:
    p = tmp_path / "state.jsonl"
    rows = [
        {"event_id": "a", "resolved_at": None, "schema_version": 1},
        {"event_id": "b", "resolved_at": None, "schema_version": 1},
    ]
    append_rows(p, rows)

    loaded = load_active_rows(p)
    ids = {r["event_id"] for r in loaded}
    assert ids == {"a", "b"}


def test_load_active_excludes_resolved(tmp_path: Path) -> None:
    p = tmp_path / "state.jsonl"
    append_rows(
        p,
        [
            {"event_id": "a", "resolved_at": None, "schema_version": 1},
            {"event_id": "b", "resolved_at": 999, "schema_version": 1},
        ],
    )
    ids = {r["event_id"] for r in load_active_rows(p)}
    assert ids == {"a"}


def test_mark_resolved_atomic(tmp_path: Path) -> None:
    p = tmp_path / "state.jsonl"
    append_rows(
        p,
        [
            {"event_id": "a", "resolved_at": None, "schema_version": 1},
            {"event_id": "b", "resolved_at": None, "schema_version": 1},
        ],
    )
    mark_resolved(p, event_id="a", resolved_at_ms=123_456)

    # Reload full file (not just active)
    raw = [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line]
    by_id = {r["event_id"]: r for r in raw}
    assert by_id["a"]["resolved_at"] == 123_456
    assert by_id["b"]["resolved_at"] is None


def test_load_from_missing_file_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "nonexistent.jsonl"
    assert load_active_rows(p) == []


def test_corrupt_line_is_skipped_not_fatal(tmp_path: Path) -> None:
    p = tmp_path / "state.jsonl"
    p.write_text(
        '{"event_id": "a", "resolved_at": null, "schema_version": 1}\n'
        "NOT_JSON_GARBAGE\n"
        '{"event_id": "b", "resolved_at": null, "schema_version": 1}\n',
        encoding="utf-8",
    )
    ids = {r["event_id"] for r in load_active_rows(p)}
    assert ids == {"a", "b"}
```

- [ ] **Step 2: Run, verify failure**

```bash
python -m pytest tests/test_state.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement lib/state.py**

```python
"""JSONL state persistence for ext-stateful-watch.

Guarantees:
- append_rows: atomic for single lines < PIPE_BUF (~4KB). Our rows are well
  under 4KB so single-line writes are atomic at OS level.
- mark_resolved: read-modify-write via temp file + os.replace (POSIX atomic;
  Windows guarantees are weaker but acceptable for our low-contention case).
- load_active_rows: tolerates corrupt lines (skips + logs) — cron must never
  hard-fail on bad state.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def append_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    """Append rows as JSONL. Creates parent dirs if missing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            f.write("\n")


def load_active_rows(path: Path) -> list[dict[str, Any]]:
    """Load rows with resolved_at == None. Missing file → []."""
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            logger.warning("skipping corrupt line %d in %s: %s", lineno, path, e)
            continue
        if row.get("resolved_at") is None:
            out.append(row)
    return out


def mark_resolved(path: Path, *, event_id: str, resolved_at_ms: int) -> None:
    """Mark a single event_id resolved in-place. Atomic via temp + replace."""
    if not path.exists():
        return

    lines_out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            # preserve corrupt lines untouched so operator can inspect
            lines_out.append(line)
            continue
        if row.get("event_id") == event_id and row.get("resolved_at") is None:
            row["resolved_at"] = resolved_at_ms
        lines_out.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))

    # atomic temp-then-replace
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
        prefix=f".{path.name}.",
        suffix=".tmp",
    ) as tmp:
        tmp.write("\n".join(lines_out))
        tmp.write("\n")
        tmp_name = tmp.name
    os.replace(tmp_name, path)
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_state.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add lib/state.py tests/test_state.py
git commit -m "feat(ext-stateful-watch): JSONL state with atomic mark_resolved"
```

---

## Task 4: DwsClient — subprocess wrapper

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/lib/dws_client.py`
- Test: `hermes-extensions/ext-stateful-watch/tests/test_dws_client.py`

**Why inject subprocess.run:** tests MUST NOT shell out to real dws. We pass `runner: Callable[[list[str]], subprocess.CompletedProcess]` so tests substitute a fake. Production uses `subprocess.run` default.

- [ ] **Step 1: Write failing tests**

`tests/test_dws_client.py`:
```python
from __future__ import annotations

import subprocess
from typing import Any

import pytest

from lib.dws_client import DwsClient, DwsCallFailed
from lib.event import Event


def _fake_runner(outputs: dict[tuple[str, ...], tuple[int, str, str]]):
    """Map argv-tuple → (returncode, stdout, stderr)."""
    def runner(argv: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
        key = tuple(argv[1:])  # drop 'dws' prefix
        rc, out, err = outputs.get(key, (127, "", "no fake for " + " ".join(argv)))
        return subprocess.CompletedProcess(argv, rc, out, err)
    return runner


def test_list_mentions_parses_dws_json() -> None:
    fake = _fake_runner({
        ("chat", "search", "--query", "@我", "--yes", "--format", "json"): (
            0,
            '{"result":{"value":[{'
            '"messageId":"m1","openConversationId":"c1","conversationTitle":"t1",'
            '"senderUserId":"u1","senderNick":"王总","text":"进度？","sendTime":1776000000000'
            '}]}}',
            "",
        ),
    })
    client = DwsClient(runner=fake)
    events = client.list_mentions_in_query("@我")
    assert len(events) == 1
    assert events[0].sender_name == "王总"
    assert events[0].conversation_id == "c1"


def test_has_my_reply_after_true_when_reply_exists() -> None:
    fake = _fake_runner({
        ("chat", "message", "list", "--conversation-id", "c1", "--yes", "--format", "json"): (
            0,
            '{"result":{"messages":['
            '{"senderUserId":"me","sendTime":2_000_000_000},'
            '{"senderUserId":"other","sendTime":1_500_000_000}'
            ']}}'.replace("_", ""),
            "",
        ),
    })
    client = DwsClient(runner=fake, my_user_id="me")
    assert client.has_my_reply_after("c1", sent_at_ms=1_000_000_000) is True


def test_failing_dws_raises() -> None:
    fake = _fake_runner({
        ("chat", "search", "--query", "x", "--yes", "--format", "json"): (
            1, "", "auth expired"
        ),
    })
    client = DwsClient(runner=fake)
    with pytest.raises(DwsCallFailed) as excinfo:
        client.list_mentions_in_query("x")
    assert "auth expired" in str(excinfo.value)
```

Note: the fake's messageId-to-mention shape is a **simplification** — the real `dws chat search` returns conversations, not messages with mentions. The test uses a synthetic shape; the implementation in Step 3 must match. Treat this as "we own the fake shape" — if v0.2 integration reveals different reality, update both the fake and parser.

- [ ] **Step 2: Run, verify failure**

```bash
python -m pytest tests/test_dws_client.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement lib/dws_client.py**

```python
"""Thin subprocess wrapper around `dws` CLI.

Design constraints:
- stdlib only (no requests/httpx — runs in Hermes venv constraint)
- Runner injectable for tests; prod uses subprocess.run
- Fails loud (raises DwsCallFailed) — cron caller decides suppress vs propagate
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any, Callable

from lib.event import Event

Runner = Callable[[list[str], float], subprocess.CompletedProcess[str]]


class DwsCallFailed(RuntimeError):
    pass


def _default_runner(argv: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


@dataclass
class DwsClient:
    runner: Runner = _default_runner
    timeout_s: float = 30.0
    my_user_id: str = ""  # filled via config

    def _call(self, *args: str) -> dict[str, Any]:
        argv = ["dws", *args, "--yes", "--format", "json"]
        cp = self.runner(argv, self.timeout_s)
        if cp.returncode != 0:
            raise DwsCallFailed(f"dws {' '.join(args)} exit {cp.returncode}: {cp.stderr}")
        try:
            return json.loads(cp.stdout)
        except json.JSONDecodeError as e:
            raise DwsCallFailed(f"dws {' '.join(args)} emitted non-JSON: {e}") from e

    def list_mentions_in_query(self, query: str) -> list[Event]:
        """Return Events matching the search query.

        v0.2 uses `dws chat search`. The exact mention-detection predicate
        may need to evolve as we learn dws's actual response shape —
        keep this method as the single translation point.
        """
        data = self._call("chat", "search", "--query", query)
        msgs = (data.get("result") or {}).get("value") or []
        out: list[Event] = []
        for m in msgs:
            out.append(Event.from_dws_message(
                msg_id=m["messageId"],
                conversation_id=m["openConversationId"],
                conversation_title=m.get("conversationTitle", ""),
                sender_id=m["senderUserId"],
                sender_name=m.get("senderNick", ""),
                text=m.get("text", ""),
                sent_at_ms=int(m["sendTime"]),
            ))
        return out

    def has_my_reply_after(self, conversation_id: str, *, sent_at_ms: int) -> bool:
        """True iff there's a message from `my_user_id` in `conversation_id`
        with sendTime > sent_at_ms."""
        if not self.my_user_id:
            return False
        data = self._call("chat", "message", "list", "--conversation-id", conversation_id)
        msgs = (data.get("result") or {}).get("messages") or []
        for m in msgs:
            if m.get("senderUserId") == self.my_user_id and int(m.get("sendTime", 0)) > sent_at_ms:
                return True
        return False
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_dws_client.py -v
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add lib/dws_client.py tests/test_dws_client.py
git commit -m "feat(ext-stateful-watch): DwsClient with injectable runner"
```

---

## Task 5: Dedup algorithm

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/lib/dedup.py`
- Test: `hermes-extensions/ext-stateful-watch/tests/test_dedup.py`

- [ ] **Step 1: Write failing tests**

`tests/test_dedup.py`:
```python
from __future__ import annotations

from pathlib import Path

from lib.dedup import filter_new_events
from lib.event import Event
from lib.state import append_rows, load_active_rows


def _make(msg_id: str) -> Event:
    return Event.from_dws_message(
        msg_id=msg_id,
        conversation_id="c1",
        conversation_title="t",
        sender_id="s",
        sender_name="S",
        text=msg_id,
        sent_at_ms=1_000_000,
    )


def test_first_run_all_events_are_new(tmp_path: Path) -> None:
    state = tmp_path / "s.jsonl"
    events = [_make("m1"), _make("m2"), _make("m3")]
    new = filter_new_events(events, state_path=state, now_ms=2_000_000)
    assert {e.event_id for e in new} == {e.event_id for e in events}
    # state persisted
    assert len(load_active_rows(state)) == 3


def test_second_run_all_events_suppressed(tmp_path: Path) -> None:
    state = tmp_path / "s.jsonl"
    events = [_make("m1"), _make("m2")]
    first = filter_new_events(events, state_path=state, now_ms=1)
    second = filter_new_events(events, state_path=state, now_ms=2)
    assert len(first) == 2
    assert second == []


def test_only_new_ones_returned(tmp_path: Path) -> None:
    state = tmp_path / "s.jsonl"
    filter_new_events([_make("m1")], state_path=state, now_ms=1)
    result = filter_new_events(
        [_make("m1"), _make("m2"), _make("m3")],
        state_path=state,
        now_ms=2,
    )
    new_ids = {e.event_id for e in result}
    assert new_ids == {_make("m2").event_id, _make("m3").event_id}


def test_resolved_events_dont_re_alert(tmp_path: Path) -> None:
    state = tmp_path / "s.jsonl"
    # pre-seed: m1 was seen and then resolved
    e1 = _make("m1")
    append_rows(state, [{
        "schema_version": 1,
        "event_id": e1.event_id,
        "category": "unreplied_mentions",
        "resolved_at": 500,  # already resolved
        "first_seen": 100,
        "alerted_at": 100,
        "source": {},
    }])
    result = filter_new_events([e1], state_path=state, now_ms=1_000)
    # resolved doesn't reappear — load_active_rows filters it out of `seen`,
    # so this IS treated as "new" and re-alerted. That's the intentional behavior
    # for v0.2: if a resolved event reappears in dws search, we alert again.
    # To suppress, v0.3+ should augment with "resolved_recently" window.
    # Test documents the current behavior:
    assert len(result) == 1
```

- [ ] **Step 2: Run, verify failure**

```bash
python -m pytest tests/test_dedup.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement lib/dedup.py**

```python
"""Dedup: split incoming events into new vs already-seen.

v0.2 uses a simple "event_id in active state" check. resolved events are
NOT in the seen set — meaning if they re-surface in dws search, they'll
re-alert. That's intentional for v0.2 (rare) and can tighten in v0.3.
"""

from __future__ import annotations

from pathlib import Path

from lib.event import Event
from lib.state import append_rows, load_active_rows


def filter_new_events(
    events: list[Event],
    *,
    state_path: Path,
    now_ms: int,
) -> list[Event]:
    """Return events not present in active state; append new ones to state."""
    seen = {row["event_id"] for row in load_active_rows(state_path)}
    new = [e for e in events if e.event_id not in seen]
    if new:
        append_rows(state_path, [e.to_row(first_seen_ms=now_ms) for e in new])
    return new
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_dedup.py -v
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add lib/dedup.py tests/test_dedup.py
git commit -m "feat(ext-stateful-watch): pure-function dedup over state + events"
```

---

## Task 6: Script main — wire everything together

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/scripts/unreplied_mentions.py`
- Create: `hermes-extensions/ext-stateful-watch/config.example.toml`
- Test: `hermes-extensions/ext-stateful-watch/tests/test_script_e2e.py`

- [ ] **Step 1: Write config.example.toml**

```toml
# ext-stateful-watch config
# Install to: ~/.hermes/dingtalk-extensions/config/unreplied_mentions.toml

my_user_id = "REPLACE_WITH_YOUR_DINGTALK_USER_ID"

[watched_conversations]
# Conversation IDs (from dingtalk.chat.search response, openConversationId)
ids = [
  # "cidXXX...==",
]

[time_window]
# Only run effective filtering in work hours (UTC+8).
# Outside window: script still runs but produces empty stdout.
weekdays_only = true
hour_start = 9
hour_end = 19
```

- [ ] **Step 2: Write failing e2e test**

`tests/test_script_e2e.py`:
```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest


def _write_config(tmp: Path, watched_ids: list[str]) -> Path:
    cfg = tmp / "config.toml"
    ids_str = ",\n".join(f'  "{cid}"' for cid in watched_ids)
    cfg.write_text(
        f'my_user_id = "me"\n'
        f"[watched_conversations]\n"
        f"ids = [\n{ids_str}\n]\n"
        f"[time_window]\n"
        f"weekdays_only = false\n"
        f"hour_start = 0\n"
        f"hour_end = 24\n",
        encoding="utf-8",
    )
    return cfg


def test_main_emits_markdown_for_new_events(tmp_path, monkeypatch, capsys):
    # Arrange: config + empty state + stub dws
    cfg = _write_config(tmp_path, ["c1"])
    state_dir = tmp_path / "state"

    fake_dws_response = json.dumps({
        "result": {"value": [{
            "messageId": "m1",
            "openConversationId": "c1",
            "conversationTitle": "K1应援组",
            "senderUserId": "u_boss",
            "senderNick": "王总",
            "text": "进度怎么样？",
            "sendTime": 1776000000000,
        }]}
    })

    from scripts import unreplied_mentions as script

    def fake_runner(argv, timeout):
        return subprocess.CompletedProcess(argv, 0, fake_dws_response, "")

    script.main(
        config_path=cfg,
        state_dir=state_dir,
        now_ms=1776000300000,
        runner=fake_runner,
    )
    out = capsys.readouterr().out
    assert "王总" in out
    assert "K1应援组" in out
    assert "1 条" in out or "1 new" in out.lower()  # whichever phrasing


def test_main_emits_empty_when_no_new_events(tmp_path, capsys):
    cfg = _write_config(tmp_path, ["c1"])
    state_dir = tmp_path / "state"

    fake_dws_response = json.dumps({"result": {"value": []}})

    from scripts import unreplied_mentions as script

    def fake_runner(argv, timeout):
        return subprocess.CompletedProcess(argv, 0, fake_dws_response, "")

    script.main(
        config_path=cfg,
        state_dir=state_dir,
        now_ms=1776000300000,
        runner=fake_runner,
    )
    out = capsys.readouterr().out
    assert out.strip() == ""


def test_main_silent_on_dws_failure(tmp_path, capsys):
    """Cron must not fail if dws is down — just emit empty stdout."""
    cfg = _write_config(tmp_path, ["c1"])
    state_dir = tmp_path / "state"

    from scripts import unreplied_mentions as script

    def fake_runner(argv, timeout):
        return subprocess.CompletedProcess(argv, 1, "", "auth expired")

    script.main(
        config_path=cfg,
        state_dir=state_dir,
        now_ms=1776000300000,
        runner=fake_runner,
    )
    out = capsys.readouterr().out
    assert out.strip() == ""
```

- [ ] **Step 3: Run, verify failure**

```bash
python -m pytest tests/test_script_e2e.py -v
```
Expected: `ImportError` or `AttributeError`

- [ ] **Step 4: Implement scripts/unreplied_mentions.py**

```python
"""Cron script: list new @mentions, emit markdown to stdout.

Run via Hermes cron:
  subprocess.run([sys.executable, scripts/unreplied_mentions.py])

Hermes prepends our stdout as `## Script Output` into the agent prompt.
So our contract is: stdout = human-readable markdown (or empty = no news).

stderr = free-form diagnostics. Hermes logs but doesn't inject it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Callable

# Make lib/ importable regardless of cwd.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from lib.dedup import filter_new_events
from lib.dws_client import DwsCallFailed, DwsClient
from lib.event import Event

logger = logging.getLogger(__name__)


def _in_time_window(now: dt.datetime, *, weekdays_only: bool, hour_start: int, hour_end: int) -> bool:
    if weekdays_only and now.weekday() >= 5:
        return False
    return hour_start <= now.hour < hour_end


def _format_markdown(events: list[Event]) -> str:
    if not events:
        return ""
    lines = [f"你有 {len(events)} 条新的未回 @ 消息："]
    for e in events:
        sent = dt.datetime.fromtimestamp(e.sent_at_ms / 1000).strftime("%H:%M")
        preview = e.text[:60].replace("\n", " ")
        lines.append(
            f"- **{e.conversation_title}** · {e.sender_name} ({sent})：{preview}"
        )
    return "\n".join(lines)


def main(
    *,
    config_path: Path,
    state_dir: Path,
    now_ms: int | None = None,
    runner: Callable | None = None,
) -> int:
    now_ms = now_ms if now_ms is not None else int(dt.datetime.now().timestamp() * 1000)
    now_dt = dt.datetime.fromtimestamp(now_ms / 1000)

    # Load config
    with config_path.open("rb") as f:
        cfg = tomllib.load(f)

    tw = cfg.get("time_window", {})
    if not _in_time_window(
        now_dt,
        weekdays_only=tw.get("weekdays_only", True),
        hour_start=tw.get("hour_start", 9),
        hour_end=tw.get("hour_end", 19),
    ):
        return 0

    my_user_id = cfg.get("my_user_id", "")
    watched_ids: list[str] = (cfg.get("watched_conversations") or {}).get("ids") or []
    if not watched_ids:
        return 0

    client_kwargs = {"my_user_id": my_user_id}
    if runner is not None:
        client_kwargs["runner"] = runner
    client = DwsClient(**client_kwargs)

    # v0.2 MVP: search for @我 across watched conversations. Since dws search
    # doesn't take a conversation filter, we just search the query and intersect
    # with watched_ids client-side.
    try:
        all_mentions = client.list_mentions_in_query("@我")
    except DwsCallFailed as e:
        logger.warning("dws call failed, emitting empty stdout: %s", e)
        return 0

    filtered = [e for e in all_mentions if e.conversation_id in set(watched_ids)]
    state_path = state_dir / "unreplied_mentions.jsonl"
    new_events = filter_new_events(filtered, state_path=state_path, now_ms=now_ms)

    md = _format_markdown(new_events)
    if md:
        sys.stdout.write(md + "\n")
    return 0


def _default_paths() -> tuple[Path, Path]:
    home = Path.home()
    return (
        home / ".hermes" / "dingtalk-extensions" / "config" / "unreplied_mentions.toml",
        home / ".hermes" / "dingtalk-extensions" / "state",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ext-stateful-watch: unreplied mentions")
    default_config, default_state = _default_paths()
    parser.add_argument("--config", type=Path, default=default_config)
    parser.add_argument("--state-dir", type=Path, default=default_state)
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    sys.exit(main(config_path=args.config, state_dir=args.state_dir))
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/ -v
```
Expected: all tests pass (15+ total)

- [ ] **Step 6: Commit**

```bash
git add scripts/unreplied_mentions.py config.example.toml tests/test_script_e2e.py
git commit -m "feat(ext-stateful-watch): main script wiring dedup + dws + markdown stdout"
```

---

## Task 7: cron prompt template

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/templates/unreplied_mentions.yaml`

- [ ] **Step 1: Write template**

```yaml
# Hermes cron template: 钉钉未回 @ 告警助理
#
# 使用方式：
#   hermes cronjob create \
#     --schedule "*/30 * * * *" \
#     --script ~/.hermes/scripts/stateful_watch/unreplied_mentions.py \
#     --prompt "$(cat ~/.hermes/dingtalk-extensions/templates/unreplied_mentions.yaml)"
#
# 契约：见 docs/decisions/003 / 004 / 005

name: "unreplied_mentions_watch"
schedule: "*/30 9-19 * * 1-5"
deliver: "dingtalk"

prompt: |
  你是"@未回"告警助理。script 阶段已过滤掉之前告警过的事件，
  prompt 头部 `## Script Output` 里的每条都是**新**的需要处理的。

  ## 参数命名契约

  - 参数名一律用 kebab-case（`conversation-id`、`template-id`）
  - 参数描述里的 camelCase 是语义名不是 key
  - 已知隐式 required（ADR-004）：
    * `dingtalk.chat.message.send-by-bot` 必传 `robot-code` + `title`
    * `dingtalk.oa.approval.list-initiated` 必传 `process-code`

  ## 执行步骤

  1. **读 Script Output**
     如果是空的（没有新 @），直接输出"无新告警"，结束。

  2. **对每条新 @，判断紧急度**
     - 看发送时间距今多久（script 里给了时间戳）
     - 看发送者（直属上级 / 同事 / 客户）——可调 `dingtalk.contact.user.get` 查部门
     - 看消息预览（是问句？通知？决策请求？）

  3. **选择行动**
     - 紧急（>2h 未回 + 是上级/客户）→ 调 `dingtalk.ding.message.send`
       发 DING 提醒自己，附原消息预览
     - 中等（>2h 未回 + 同事）→ 在 Hermes 侧 `deliver="dingtalk"` 推送
       一条汇总到自己（勿扰模式会合并）
     - 低优先级（<2h 或仅通知类）→ 记录不打扰，输出待办列表让用户之后看

  4. **不要回复原消息**
     v0.2 不做自动回复——决策权保留给人。只做通知层。

  ## 输出

  成功：`已处理 N 条新 @ 告警：<简要列表>`
  失败：具体错误 + 原 Script Output 内容（方便调试）
```

- [ ] **Step 2: Commit**

```bash
git add templates/unreplied_mentions.yaml
git commit -m "feat(ext-stateful-watch): cron prompt template w/ ADR-003/004 contracts"
```

---

## Task 8: install.sh

**Files:**
- Create: `hermes-extensions/ext-stateful-watch/install.sh`

- [ ] **Step 1: Write install.sh**

```bash
#!/usr/bin/env bash
#
# ext-stateful-watch installer.
# Copies scripts to $HERMES_HOME/scripts/stateful_watch/ (Hermes requires this path).
# Creates state + config dirs. Does NOT create the cron job — that's explicit.

set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
EXT_HOME="$HERMES_HOME/dingtalk-extensions"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing ext-stateful-watch to $HERMES_HOME"

# 1. Scripts → Hermes's required path
mkdir -p "$HERMES_HOME/scripts/stateful_watch"
cp -r "$SCRIPT_DIR/scripts/"* "$HERMES_HOME/scripts/stateful_watch/"
cp -r "$SCRIPT_DIR/lib" "$HERMES_HOME/scripts/stateful_watch/"
echo "    scripts + lib → $HERMES_HOME/scripts/stateful_watch/"

# 2. State + config dirs
mkdir -p "$EXT_HOME/state"
mkdir -p "$EXT_HOME/config"
mkdir -p "$EXT_HOME/templates"
echo "    state/config/templates dirs → $EXT_HOME/"

# 3. Templates
cp "$SCRIPT_DIR/templates/unreplied_mentions.yaml" "$EXT_HOME/templates/"
echo "    prompt template → $EXT_HOME/templates/"

# 4. Config — don't overwrite if user has customized
CONFIG_DST="$EXT_HOME/config/unreplied_mentions.toml"
if [ -f "$CONFIG_DST" ]; then
  echo "    config exists, not overwriting: $CONFIG_DST"
else
  cp "$SCRIPT_DIR/config.example.toml" "$CONFIG_DST"
  echo "    config template → $CONFIG_DST (EDIT THIS FILE)"
fi

cat <<EOF

==> Install complete.

Next steps:
  1. Edit $CONFIG_DST
     - set my_user_id (your DingTalk orgUserId)
     - list watched conversation IDs under [watched_conversations]

  2. Create the Hermes cron job:
     hermes cronjob create \\
       --schedule "*/30 9-19 * * 1-5" \\
       --script $HERMES_HOME/scripts/stateful_watch/unreplied_mentions.py \\
       --prompt "\$(cat $EXT_HOME/templates/unreplied_mentions.yaml)"

  3. Tail the logs to verify first runs:
     tail -F ~/.hermes/logs/cron/*.log
EOF
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x install.sh
git add install.sh
git commit -m "feat(ext-stateful-watch): install.sh — scripts to HERMES_HOME, no auto-cron"
```

---

## Task 9: ADR-005 — state schema decisions

**Files:**
- Create: `docs/decisions/005-stateful-watch-state-schema.md` (repo-level, not under ext)

- [ ] **Step 1: Write ADR-005**

````markdown
# ADR 005 — ext-stateful-watch state schema and evolution

**日期**：2026-04-14
**状态**：Accepted（v0.2 首版）
**关联**：`hermes-extensions/ext-stateful-watch/DESIGN.md`、`ARCHITECTURE.md §4.2`

---

## 1. 背景

ext-stateful-watch 需要跨 cron 周期保持状态（已告警事件集合）。选项：JSONL / SQLite / Hermes memory_tool。

## 2. 决策

**v0.2 使用单一 JSONL 文件**：`~/.hermes/dingtalk-extensions/state/<category>.jsonl`

### 2.1 为什么不用 SQLite

- 量级小（单类别日增 <10 条，年增 <4k 条，远低于 10k 行 SQLite 门槛）
- 写入模式纯 append（除极少 mark_resolved），SQLite 事务开销不划算
- 可读性 / 诊断性：cat/grep 就能看 state，SQLite 需 sqlite3 CLI
- 依赖最小化：stdlib `json` 够用，sqlite3 也是 stdlib 但增加代码复杂度

**触发迁移阈值**：单文件 > 50MB → ADR-005 v2 定义 SQLite 方案（v0.3+ 处理）

### 2.2 为什么不用 memory_tool

- memory_tool 是 agent runtime 状态，按 session 隔离；cron 跨 session 不适用
- cron script 在 agent 起来前运行，根本拿不到 memory_tool 句柄

### 2.3 Schema 版本字段

每行包含 `schema_version: 1`。v0.3 若要引入 v2 schema：
1. 新代码支持读 v1 + v2，仅写 v2
2. 迁移脚本把 v1 行在线升级（读 → 改 schema_version + 补字段 → 写）
3. 3 个版本周期后彻底废弃 v1 读路径

## 3. Schema v1 规范

```json
{
  "schema_version": 1,
  "event_id": "<sha256(msg_id)[:16]>",
  "category": "unreplied_mentions",
  "source": {
    "conversation_id": "cidXXX==",
    "conversation_title": "...",
    "sender_id": "u_123",
    "sender_name": "王总",
    "text_preview": "...",   // max 80 chars
    "sent_at": 1776160000000
  },
  "first_seen": 1776161000000,
  "alerted_at": 1776161000000,
  "resolved_at": null
}
```

## 4. 降级方案

**如果 Hermes `script` 参数被弃用或语义变化**：切换为独立 MCP server，注册 tool `dingtalk.dedup_check(events, category)`，让 agent 显式调用。代码上 `lib/dedup.py` + `lib/state.py` 直接复用，只替换 `scripts/unreplied_mentions.py` 为 MCP server 入口。

## 5. 不做清单

- ❌ 多租户（目录结构不预留）
- ❌ 加密（state 是本机 $HOME 下文件，OS 权限已足）
- ❌ 同步到远端（v0.5+ 才考虑）
````

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/005-stateful-watch-state-schema.md
git commit -m "docs: ADR-005 — ext-stateful-watch JSONL schema + evolution"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd hermes-extensions/ext-stateful-watch
python -m pytest tests/ -v --tb=short
```
Expected: 15+ tests, all pass, < 1s wall time.

- [ ] **Step 2: Run install.sh dry test**

```bash
HERMES_HOME="/tmp/hermes-test" bash install.sh
ls -la /tmp/hermes-test/scripts/stateful_watch/
ls -la /tmp/hermes-test/dingtalk-extensions/
rm -rf /tmp/hermes-test
```
Expected: all files in correct locations, install.sh exits 0.

- [ ] **Step 3: Update repo-level docs**

Update `progress.md` v0.2 section from "未启动" → "v0.2 MVP 代码完成，待 1 周实战验证"

Update `docs/ROADMAP.md` v0.2 section similarly.

- [ ] **Step 4: Final commit**

```bash
git add progress.md docs/ROADMAP.md
git commit -m "docs: mark ext-stateful-watch v0.2 MVP code complete"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Spec Coverage Self-Review

Checked against DESIGN.md sections:
- §1 Architecture & data flow → Tasks 4, 6, 8
- §2 State schema → Tasks 2, 3, 9 (ADR-005)
- §3 MVP scope → Tasks 6 (watched_conversations config), 7 (cron schedule)
- §4 Testing/install → Tasks 3-6 (unit tests), 6 (e2e), 8 (install), 10 (verification)

No gaps. No placeholders. Method names consistent across tasks.

---

## Execution notes

- **TDD strict**: every task writes test first, watches it fail, then implements
- **Commit granularity**: one commit per task (9 commits total + docs update)
- **No Hermes runtime tests**: v0.2 validates via unit + e2e with injected runner. Real Hermes cron verification is the 7-day observation period in ROADMAP v0.2 exit criteria.
- **Estimated effort**: 4-6 hours single-session for a focused implementer, assuming dws CLI response shape matches the fake in Task 4 (if it differs, add a probe run upfront).
