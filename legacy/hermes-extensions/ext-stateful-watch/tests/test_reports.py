from lib.watchers.reports import filter_new


def _report(rid, creator="U_REDACTED_1", create_time=1776000000000):
    return {
        "report_id": rid,
        "creator_user_id": "uid_x",
        "creator_user_name": creator,
        "create_time": create_time,
        "modified_time": create_time,
    }


def test_filter_new_all_fresh():
    curr = [_report("r1"), _report("r2")]
    evs = filter_new(set(), curr)
    assert len(evs) == 2
    assert {e.source_id for e in evs} == {"r1", "r2"}


def test_filter_new_excludes_seen():
    seen = {"r1", "r2"}
    curr = [_report("r2"), _report("r3")]
    evs = filter_new(seen, curr)
    assert len(evs) == 1
    assert evs[0].source_id == "r3"


def test_filter_new_empty_input():
    assert filter_new(set(), []) == []
    assert filter_new({"r1"}, []) == []


def test_event_fields():
    curr = [_report("r1", creator="U_REDACTED_X")]
    e = filter_new(set(), curr)[0]
    assert e.kind == "report"
    assert e.severity == "info"
    assert "U_REDACTED_X" in e.detail
    assert e.extra.get("creator_user_id") == "uid_x"


def test_filter_new_preserves_order():
    curr = [_report("r3"), _report("r1"), _report("r2")]
    ids = [e.source_id for e in filter_new(set(), curr)]
    assert ids == ["r3", "r1", "r2"]
