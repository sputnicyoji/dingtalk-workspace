#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.config import load_config
from lib.dws_client import DwsClient, DwsCallFailed
from lib.runtime import config_path, state_dir
from lib.state import append_row, load_rows
from lib.watchers.approvals import detect_timeouts, diff_snapshots

PENDING_LOOKBACK_DAYS = 7
TZ = timezone(timedelta(hours=8))


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def _normalize_item(item: dict, role: str) -> dict:
    approval_id = (
        item.get("processInstanceId")
        or item.get("approval_id")
        or item.get("id")
        or ""
    )
    title = (
        item.get("title")
        or item.get("processName")
        or item.get("formName")
        or ""
    )
    status = (item.get("status") or item.get("result") or "pending").lower()
    return {
        "approval_id": str(approval_id),
        "role": role,
        "status": status,
        "title": title,
    }


def _prior_first_seen_map(prior_rows: list[dict]) -> tuple[list[dict], set[str]]:
    """Extract last snapshot and already-alerted set from prior state rows."""
    last_snapshot: list[dict] = []
    alerted: set[str] = set()
    for r in prior_rows:
        if r.get("kind") == "snapshot":
            last_snapshot = r.get("items", [])
        elif r.get("kind") == "alerted":
            sid = r.get("source_id")
            if sid:
                alerted.add(sid)
    return last_snapshot, alerted


def _stitch_first_seen(curr: list[dict], prior: list[dict], now: int) -> list[dict]:
    prior_fs = {r["approval_id"]: r.get("first_seen", now) for r in prior}
    return [
        {**r, "first_seen": prior_fs.get(r["approval_id"], now)}
        for r in curr
    ]


def run(client: DwsClient | None = None, now: int | None = None) -> int:
    cfg = load_config(config_path())["approvals"]
    client = client or DwsClient()
    sfile = state_dir() / "approvals.jsonl"
    now = now if now is not None else int(time.time())

    start = _iso(now - PENDING_LOOKBACK_DAYS * 86400)

    curr: list[dict] = []
    had_failure = False

    try:
        pending_resp = client.invoke(["oa", "approval", "list-pending", "--start", start])
        pending_items = pending_resp.get("result", {}).get("processInstanceList", []) or []
        curr.extend(_normalize_item(i, "pending") for i in pending_items)
    except DwsCallFailed as e:
        print(f"[approvals] list-pending failed: {e}", file=sys.stderr)
        had_failure = True

    for pc in cfg.get("initiated_process_codes", []) or []:
        try:
            init_resp = client.invoke(["oa", "approval", "list-initiated", "--process-code", pc])
            init_items = init_resp.get("result", []) if isinstance(init_resp.get("result"), list) \
                else init_resp.get("result", {}).get("list", [])
            for item in init_items or []:
                curr.append(_normalize_item(item, "initiated"))
        except DwsCallFailed as e:
            print(f"[approvals] list-initiated pc={pc} failed: {e}", file=sys.stderr)
            had_failure = True

    if had_failure and not curr:
        return 0

    prior_rows = list(load_rows(sfile))
    prior_snapshot, alerted = _prior_first_seen_map(prior_rows)
    curr_snapshot = _stitch_first_seen(curr, prior_snapshot, now)

    append_row(sfile, {"kind": "snapshot", "ts": now, "items": curr_snapshot})

    events = diff_snapshots(prior_snapshot, curr_snapshot)
    events += detect_timeouts(curr_snapshot, now, cfg["timeout_hours"], alerted)

    if not events:
        return 0

    print("# stateful-watch / approvals\n")
    for e in events:
        print(e.to_markdown_row())
        append_row(sfile, {
            "kind": "alerted",
            "ts": now,
            "event_id": e.event_id,
            "source_id": e.source_id,
            "detail": e.detail,
        })
    return 0


if __name__ == "__main__":
    sys.exit(run())
