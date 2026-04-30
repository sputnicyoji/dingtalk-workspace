from pathlib import Path

import pytest

from lib.config import load_config, DEFAULTS


def test_load_missing_file_returns_defaults(tmp_path: Path):
    cfg = load_config(tmp_path / "absent.yaml")
    assert cfg == DEFAULTS


def test_load_partial_merges_with_defaults(tmp_path: Path):
    f = tmp_path / "c.yaml"
    f.write_text(
        "approvals:\n"
        "  timeout_hours: 8\n"
        "todos:\n"
        "  stale_days: 14\n",
        encoding="utf-8",
    )
    cfg = load_config(f)
    assert cfg["approvals"]["timeout_hours"] == 8
    assert cfg["approvals"]["roles_high_priority"] == DEFAULTS["approvals"]["roles_high_priority"]
    assert cfg["approvals"]["initiated_process_codes"] == []
    assert cfg["todos"]["stale_days"] == 14
    assert cfg["todos"]["reminder_interval_days"] == DEFAULTS["todos"]["reminder_interval_days"]
    assert cfg["reports"] == DEFAULTS["reports"]


def test_load_full_override(tmp_path: Path):
    f = tmp_path / "c.yaml"
    f.write_text(
        "approvals:\n"
        "  timeout_hours: 2\n"
        "  roles_high_priority: []\n"
        "  initiated_process_codes: [\"PROC_A\", \"PROC_B\"]\n"
        "reports:\n"
        "  include_senders: [\"A\"]\n"
        "  exclude_templates: [\"X\"]\n"
        "todos:\n"
        "  stale_days: 3\n"
        "  reminder_interval_days: 1\n",
        encoding="utf-8",
    )
    cfg = load_config(f)
    assert cfg["approvals"]["initiated_process_codes"] == ["PROC_A", "PROC_B"]
    assert cfg["reports"]["include_senders"] == ["A"]


def test_load_empty_file_returns_defaults(tmp_path: Path):
    f = tmp_path / "c.yaml"
    f.write_text("", encoding="utf-8")
    assert load_config(f) == DEFAULTS


def test_defaults_has_expected_keys():
    assert set(DEFAULTS.keys()) == {"approvals", "reports", "todos"}
    assert DEFAULTS["approvals"]["timeout_hours"] == 4
    assert DEFAULTS["todos"]["stale_days"] == 7
