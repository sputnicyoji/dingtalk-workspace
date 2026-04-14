from __future__ import annotations

import json
import subprocess

import pytest

import scripts.watch_reports as watch_reports
from lib.dws_client import DwsClient
from lib.state import load_rows


def _runner(payload):
    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
    return _run


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    yield tmp_path


def _item(rid, name="U_REDACTED_1"):
    return {
        "report_id": rid,
        "create_time": 1776000000000,
        "modified_time": 1776000000000,
        "creator_user_id": "uid_x",
        "creator_user_name": name,
    }


def test_first_run_emits_all_new(isolated_home, capsys):
    payload = {"result": {"report_list": [_item("r1"), _item("r2")]}}
    client = DwsClient(runner=_runner(payload))
    watch_reports.run(client=client, now=1776000000)
    out = capsys.readouterr().out
    assert "r1" in out and "r2" in out
    sfile = isolated_home / "dingtalk-extensions" / "state" / "reports.jsonl"
    rows = list(load_rows(sfile))
    assert len(rows) == 2


def test_second_run_suppresses_seen(isolated_home, capsys):
    payload = {"result": {"report_list": [_item("r1"), _item("r2")]}}
    client = DwsClient(runner=_runner(payload))
    watch_reports.run(client=client, now=1776000000)
    capsys.readouterr()
    payload2 = {"result": {"report_list": [_item("r2"), _item("r3")]}}
    client2 = DwsClient(runner=_runner(payload2))
    watch_reports.run(client=client2, now=1776100000)
    out = capsys.readouterr().out
    assert "r3" in out
    assert "r1" not in out
    assert "r2" not in out


def test_dws_failure_empty_stdout(isolated_home, capsys):
    def failing(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="auth")
    client = DwsClient(runner=failing)
    rc = watch_reports.run(client=client, now=1776000000)
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_include_senders_filter(isolated_home, capsys, tmp_path):
    cfg_dir = tmp_path / "dingtalk-extensions" / "config"
    cfg_dir.mkdir(parents=True)
    (cfg_dir / "stateful_watch.yaml").write_text(
        "reports:\n  include_senders: [\"U_REDACTED_A\"]\n", encoding="utf-8"
    )
    payload = {"result": {"report_list": [
        _item("r1", name="U_REDACTED_A"),
        _item("r2", name="U_REDACTED_B"),
    ]}}
    client = DwsClient(runner=_runner(payload))
    watch_reports.run(client=client, now=1776000000)
    out = capsys.readouterr().out
    assert "r1" in out
    assert "r2" not in out


def test_passes_start_end_to_dws(isolated_home, capsys):
    captured = {}

    def runner(cmd, timeout):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"result": {"report_list": []}}), stderr="")

    client = DwsClient(runner=runner)
    watch_reports.run(client=client, now=1776000000)
    assert "--start" in captured["cmd"]
    assert "--end" in captured["cmd"]
