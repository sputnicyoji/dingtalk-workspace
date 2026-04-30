from pathlib import Path

from lib.state import append_row, load_rows, atomic_replace_all


def test_append_then_load(tmp_path: Path):
    f = tmp_path / "s.jsonl"
    append_row(f, {"a": 1})
    append_row(f, {"a": 2, "b": "你好"})
    rows = list(load_rows(f))
    assert rows == [{"a": 1}, {"a": 2, "b": "你好"}]


def test_append_creates_parent_dir(tmp_path: Path):
    f = tmp_path / "nested" / "deeper" / "s.jsonl"
    append_row(f, {"k": 1})
    assert f.exists()


def test_load_missing_file_returns_empty(tmp_path: Path):
    assert list(load_rows(tmp_path / "absent.jsonl")) == []


def test_load_tolerates_corrupt_line(tmp_path: Path, capsys):
    f = tmp_path / "s.jsonl"
    append_row(f, {"ok": True})
    with f.open("a", encoding="utf-8") as h:
        h.write("{not json\n")
    append_row(f, {"ok": True, "n": 2})
    rows = list(load_rows(f))
    assert rows == [{"ok": True}, {"ok": True, "n": 2}]
    assert "corrupt" in capsys.readouterr().err.lower()


def test_load_skips_blank_lines(tmp_path: Path):
    f = tmp_path / "s.jsonl"
    f.write_text('{"a":1}\n\n   \n{"a":2}\n', encoding="utf-8")
    assert list(load_rows(f)) == [{"a": 1}, {"a": 2}]


def test_atomic_replace_all(tmp_path: Path):
    f = tmp_path / "s.jsonl"
    append_row(f, {"old": True})
    append_row(f, {"old": True, "n": 2})
    atomic_replace_all(f, [{"new": 1}, {"new": 2}, {"new": 3}])
    assert list(load_rows(f)) == [{"new": 1}, {"new": 2}, {"new": 3}]


def test_atomic_replace_leaves_no_tmp(tmp_path: Path):
    f = tmp_path / "s.jsonl"
    atomic_replace_all(f, [{"x": 1}])
    leftovers = [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []
