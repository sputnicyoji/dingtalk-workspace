from __future__ import annotations

from lib.event import Event


def next_stages(
    state_map: dict,
    curr: list[dict],
    now: int,
    stale_days: int,
    reminder_interval_days: int,
) -> list[Event]:
    stale_sec = stale_days * 86400
    reminder_sec = reminder_interval_days * 86400
    out: list[Event] = []
    seen_ids: set[str] = set()

    for t in curr:
        tid = t["todo_id"]
        seen_ids.add(tid)
        prior = state_map.get(tid, {})
        prior_stage = prior.get("stage")
        if prior_stage == "closed":
            continue

        if t.get("final_status_stage") != 2:
            if prior_stage is not None:
                out.append(Event(
                    kind="todo", source_id=tid, severity="info",
                    title=t.get("subject", ""), detail="closed",
                ))
            continue

        age = now - t.get("created_time", now)
        if age < stale_sec:
            continue

        if prior_stage is None:
            out.append(Event(
                kind="todo", source_id=tid, severity="warn",
                title=t.get("subject", ""), detail="first_alert",
                extra={"age_seconds": age},
            ))
            continue

        last_ts = prior.get("ts", 0)
        if now - last_ts >= reminder_sec:
            next_n = prior.get("reminder_count", 0) + 1
            out.append(Event(
                kind="todo", source_id=tid, severity="warn",
                title=t.get("subject", ""), detail=f"reminded_{next_n}",
                extra={"reminder_count": next_n},
            ))

    for tid in set(state_map.keys()) - seen_ids:
        prior = state_map[tid]
        if prior.get("stage") == "closed":
            continue
        out.append(Event(
            kind="todo", source_id=tid, severity="info",
            title=prior.get("subject", ""), detail="closed",
        ))

    return out
