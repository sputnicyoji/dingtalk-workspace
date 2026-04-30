from lib.event import Event, make_event_id


def test_event_id_deterministic():
    a = make_event_id("approval", "xyz", "approved")
    b = make_event_id("approval", "xyz", "approved")
    assert a == b
    assert len(a) == 16
    assert all(c in "0123456789abcdef" for c in a)


def test_event_id_differs_by_kind():
    assert make_event_id("approval", "xyz", "approved") != make_event_id("todo", "xyz", "approved")


def test_event_id_differs_by_facet():
    assert make_event_id("approval", "xyz", "approved") != make_event_id("approval", "xyz", "rejected")


def test_event_to_markdown_row_minimal():
    e = Event(kind="approval", source_id="a1", severity="info", title="加班", detail="approved")
    row = e.to_markdown_row()
    assert "approval" in row
    assert "a1" in row
    assert "approved" in row
    assert "info" in row
    assert "加班" in row


def test_event_id_property_matches_helper():
    e = Event(kind="todo", source_id="t1", severity="warn", title="写周报", detail="overdue_day1")
    assert e.event_id == make_event_id("todo", "t1", "overdue_day1")


def test_event_extra_defaults_to_empty_dict():
    e = Event(kind="report", source_id="r1", severity="info", title="日报", detail="new")
    assert e.extra == {}
