from lib.watchers.approvals import diff_snapshots, detect_timeouts


def _item(approval_id, role="pending", status="pending", title="加班申请", first_seen=0):
    return {
        "approval_id": approval_id,
        "role": role,
        "status": status,
        "title": title,
        "first_seen": first_seen,
    }


def test_new_approval_is_not_event():
    prev = []
    curr = [_item("a1")]
    assert diff_snapshots(prev, curr) == []


def test_status_transition_emits_event():
    prev = [_item("a1", role="initiated", status="pending")]
    curr = [_item("a1", role="initiated", status="approved")]
    evs = diff_snapshots(prev, curr)
    assert len(evs) == 1
    e = evs[0]
    assert e.kind == "approval"
    assert e.source_id == "a1"
    assert "pending" in e.detail and "approved" in e.detail
    assert e.severity == "info"
    assert e.extra.get("role") == "initiated"


def test_no_change_no_event():
    prev = [_item("a1", status="pending")]
    curr = [_item("a1", status="pending")]
    assert diff_snapshots(prev, curr) == []


def test_disappeared_item_no_event():
    prev = [_item("a1", status="pending")]
    curr = []
    assert diff_snapshots(prev, curr) == []


def test_timeout_pending_emits_warn():
    now = 5 * 3600
    snap = [_item("a1", role="pending", status="pending", first_seen=0)]
    evs = detect_timeouts(snap, now=now, timeout_hours=4, already_alerted=set())
    assert len(evs) == 1
    e = evs[0]
    assert e.severity == "warn"
    assert e.source_id == "a1"
    assert "4" in e.detail


def test_timeout_suppressed_when_already_alerted():
    now = 5 * 3600
    snap = [_item("a1", role="pending", status="pending", first_seen=0)]
    assert detect_timeouts(snap, now=now, timeout_hours=4, already_alerted={"a1"}) == []


def test_timeout_only_for_pending_role():
    now = 5 * 3600
    snap = [_item("a1", role="initiated", status="pending", first_seen=0)]
    assert detect_timeouts(snap, now=now, timeout_hours=4, already_alerted=set()) == []


def test_timeout_only_when_status_pending():
    now = 5 * 3600
    snap = [_item("a1", role="pending", status="approved", first_seen=0)]
    assert detect_timeouts(snap, now=now, timeout_hours=4, already_alerted=set()) == []


def test_timeout_not_yet_reached():
    now = 3 * 3600
    snap = [_item("a1", role="pending", status="pending", first_seen=0)]
    assert detect_timeouts(snap, now=now, timeout_hours=4, already_alerted=set()) == []


def test_multiple_transitions():
    prev = [_item("a1", status="pending"), _item("a2", status="pending"), _item("a3", status="pending")]
    curr = [_item("a1", status="approved"), _item("a2", status="rejected"), _item("a3", status="pending")]
    evs = diff_snapshots(prev, curr)
    ids = {e.source_id for e in evs}
    assert ids == {"a1", "a2"}
