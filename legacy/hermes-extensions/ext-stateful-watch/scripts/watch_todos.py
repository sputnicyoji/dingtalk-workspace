#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.config import load_config
from lib.dws_client import DwsClient, DwsCallFailed
from lib.event import Event
from lib.runtime import config_path, state_dir
from lib.state import append_row, load_rows
from lib.watchers.todos import next_stages


def _normalize(items: list[dict]) -> list[dict]:
    out = []
    for t in items:
        created_ms = t.get("createdTime") or 0
        out.append({
            "todo_id": str(t.get("taskId", "")),
            "subject": t.get("subject", ""),
            "created_time": int(created_ms) // 1000 if created_ms else 0,
            "final_status_stage": t.get("finalStatusStage"),
        })
    return out


def _build_state_map(rows: list[dict]) -> dict:
    m: dict = {}
    for r in rows:
        tid = r.get("todo_id")
        if not tid:
            continue
        m[tid] = {
            "stage": r.get("stage"),
            "ts": r.get("ts", 0),
            "reminder_count": r.get("reminder_count", 0),
            "subject": r.get("subject", ""),
        }
    return m


def run(client: DwsClient | None = None, now: int | None = None) -> int:
    cfg = load_config(config_path())["todos"]
    client = client or DwsClient()
    sfile = state_dir() / "todos.jsonl"
    now = now if now is not None else int(time.time())

    try:
        resp = client.invoke(["todo", "task", "list"])
    except DwsCallFailed as e:
        print(f"[todos] dws failed: {e}", file=sys.stderr)
        return 0

    items = resp.get("result", {}).get("todoCards", []) or []
    curr = _normalize(items)

    prior_rows = list(load_rows(sfile))
    state_map = _build_state_map(prior_rows)

    events = next_stages(
        state_map=state_map,
        curr=curr,
        now=now,
        stale_days=cfg["stale_days"],
        reminder_interval_days=cfg["reminder_interval_days"],
    )

    if not events:
        return 0

    print("# stateful-watch / todos\n")
    for e in events:
        print(e.to_markdown_row())
        append_row(sfile, {
            "todo_id": e.source_id,
            "stage": e.detail,
            "ts": now,
            "reminder_count": e.extra.get("reminder_count", state_map.get(e.source_id, {}).get("reminder_count", 0)),
            "subject": e.title,
        })
    return 0


if __name__ == "__main__":
    sys.exit(run())
