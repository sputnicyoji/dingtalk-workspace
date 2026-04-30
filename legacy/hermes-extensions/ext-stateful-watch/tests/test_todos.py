from lib.watchers.todos import next_stages


def _todo(tid, created_time=0, final_status_stage=2, subject="写周报"):
    return {
        "todo_id": tid,
        "subject": subject,
        "created_time": created_time,
        "final_status_stage": final_status_stage,
    }


DAY = 86400


def test_fresh_todo_no_event():
    state_map = {}
    curr = [_todo("t1", created_time=0)]
    assert next_stages(state_map, curr, now=DAY, stale_days=7, reminder_interval_days=3) == []


def test_stale_threshold_emits_first_alert():
    state_map = {}
    curr = [_todo("t1", created_time=0)]
    evs = next_stages(state_map, curr, now=7 * DAY, stale_days=7, reminder_interval_days=3)
    assert len(evs) == 1
    e = evs[0]
    assert e.detail == "first_alert"
    assert e.severity == "warn"
    assert e.source_id == "t1"


def test_already_first_alerted_waits_reminder_interval():
    state_map = {"t1": {"stage": "first_alert", "ts": 7 * DAY}}
    curr = [_todo("t1", created_time=0)]
    assert next_stages(state_map, curr, now=7 * DAY + 2 * DAY, stale_days=7, reminder_interval_days=3) == []


def test_reminder_interval_elapsed_emits_reminded_1():
    state_map = {"t1": {"stage": "first_alert", "ts": 7 * DAY, "reminder_count": 0}}
    curr = [_todo("t1", created_time=0)]
    evs = next_stages(state_map, curr, now=7 * DAY + 3 * DAY, stale_days=7, reminder_interval_days=3)
    assert len(evs) == 1
    assert evs[0].detail == "reminded_1"
    assert evs[0].extra.get("reminder_count") == 1


def test_subsequent_reminders_increment_counter():
    state_map = {"t1": {"stage": "reminded_1", "ts": 10 * DAY, "reminder_count": 1}}
    curr = [_todo("t1", created_time=0)]
    evs = next_stages(state_map, curr, now=10 * DAY + 3 * DAY, stale_days=7, reminder_interval_days=3)
    assert len(evs) == 1
    assert evs[0].detail == "reminded_2"
    assert evs[0].extra.get("reminder_count") == 2


def test_finalstatusstage_change_emits_closed():
    state_map = {"t1": {"stage": "first_alert", "ts": 7 * DAY}}
    curr = [_todo("t1", created_time=0, final_status_stage=3)]
    evs = next_stages(state_map, curr, now=8 * DAY, stale_days=7, reminder_interval_days=3)
    assert len(evs) == 1
    assert evs[0].detail == "closed"


def test_no_close_event_if_never_alerted():
    state_map = {}
    curr = [_todo("t1", created_time=0, final_status_stage=3)]
    assert next_stages(state_map, curr, now=DAY, stale_days=7, reminder_interval_days=3) == []


def test_disappeared_item_emits_closed():
    state_map = {"t1": {"stage": "first_alert", "ts": 7 * DAY, "subject": "写周报"}}
    curr = []
    evs = next_stages(state_map, curr, now=8 * DAY, stale_days=7, reminder_interval_days=3)
    assert len(evs) == 1
    assert evs[0].source_id == "t1"
    assert evs[0].detail == "closed"


def test_already_closed_no_duplicate_event():
    state_map = {"t1": {"stage": "closed", "ts": 8 * DAY}}
    curr = []
    assert next_stages(state_map, curr, now=9 * DAY, stale_days=7, reminder_interval_days=3) == []


def test_mixed_batch():
    state_map = {
        "t1": {"stage": "first_alert", "ts": 7 * DAY, "reminder_count": 0},
        "t2": {"stage": "closed", "ts": 8 * DAY},
    }
    curr = [
        _todo("t1", created_time=0),
        _todo("t3", created_time=0),
    ]
    evs = next_stages(state_map, curr, now=7 * DAY + 3 * DAY, stale_days=7, reminder_interval_days=3)
    details = {(e.source_id, e.detail) for e in evs}
    assert details == {("t1", "reminded_1"), ("t3", "first_alert")}
