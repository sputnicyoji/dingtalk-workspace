from __future__ import annotations

from typing import Iterable

from lib.event import Event


def diff_snapshots(prev: list[dict], curr: list[dict]) -> list[Event]:
    prev_map = {r["approval_id"]: r for r in prev}
    out: list[Event] = []
    for row in curr:
        p = prev_map.get(row["approval_id"])
        if p is None:
            continue
        if p["status"] != row["status"]:
            out.append(Event(
                kind="approval",
                source_id=row["approval_id"],
                severity="info",
                title=row.get("title", ""),
                detail=f"{p['status']} -> {row['status']}",
                extra={"role": row.get("role", "")},
            ))
    return out


def detect_timeouts(
    snapshot: Iterable[dict],
    now: int,
    timeout_hours: int,
    already_alerted: set[str],
) -> list[Event]:
    threshold = timeout_hours * 3600
    out: list[Event] = []
    for row in snapshot:
        if row.get("role") != "pending" or row.get("status") != "pending":
            continue
        if now - row.get("first_seen", now) < threshold:
            continue
        if row["approval_id"] in already_alerted:
            continue
        out.append(Event(
            kind="approval",
            source_id=row["approval_id"],
            severity="warn",
            title=row.get("title", ""),
            detail=f"pending > {timeout_hours}h",
            extra={"role": "pending"},
        ))
    return out
