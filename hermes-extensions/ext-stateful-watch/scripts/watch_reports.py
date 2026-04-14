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
from lib.watchers.reports import filter_new

LOOKBACK_HOURS = 24
TZ = timezone(timedelta(hours=8))


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def _accepts(report: dict, cfg: dict) -> bool:
    senders = cfg.get("include_senders") or []
    if senders and report.get("creator_user_name") not in senders:
        return False
    return True


def run(client: DwsClient | None = None, now: int | None = None) -> int:
    cfg = load_config(config_path())["reports"]
    client = client or DwsClient()
    sfile = state_dir() / "reports.jsonl"
    now = now if now is not None else int(time.time())

    start = _iso(now - LOOKBACK_HOURS * 3600)
    end = _iso(now)

    try:
        resp = client.invoke(["report", "list", "--start", start, "--end", end])
    except DwsCallFailed as e:
        print(f"[reports] dws failed: {e}", file=sys.stderr)
        return 0

    items = resp.get("result", {}).get("report_list", []) or []
    items = [r for r in items if _accepts(r, cfg)]

    prior_rows = list(load_rows(sfile))
    seen_ids = {r["report_id"] for r in prior_rows if "report_id" in r}

    events = filter_new(seen_ids, items)
    if not events:
        return 0

    print("# stateful-watch / reports\n")
    for e in events:
        print(e.to_markdown_row())
        append_row(sfile, {
            "report_id": e.source_id,
            "seen_at": now,
            "creator_user_name": e.detail.replace("new from ", ""),
        })
    return 0


if __name__ == "__main__":
    sys.exit(run())
