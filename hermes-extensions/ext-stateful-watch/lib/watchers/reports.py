from __future__ import annotations

from lib.event import Event


def filter_new(seen_ids: set[str], curr: list[dict]) -> list[Event]:
    out: list[Event] = []
    for r in curr:
        rid = r["report_id"]
        if rid in seen_ids:
            continue
        creator = r.get("creator_user_name", "unknown")
        out.append(Event(
            kind="report",
            source_id=rid,
            severity="info",
            title="日报",
            detail=f"new from {creator}",
            extra={
                "creator_user_id": r.get("creator_user_id", ""),
                "create_time": r.get("create_time", 0),
            },
        ))
    return out
