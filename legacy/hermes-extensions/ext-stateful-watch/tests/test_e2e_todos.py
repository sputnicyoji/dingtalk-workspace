from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

import scripts.watch_todos as watch_todos
from lib.dws_client import DwsClient
from lib.state import load_rows

DAY = 86400


def _runner(payload):
    def _run(cmd, timeout):
        import json
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
    return _run


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    yield tmp_path


def test_first_run_stale_emits_first_alert(isolated_home, capsys):
    created_ms = 0
    now = 8 * DAY
    payload = {"result": {"todoCards": [
        {"taskId": "t1", "subject": "写周报", "createdTime": created_ms, "finalStatusStage": 2, "priority": 40, "dueTime": None},
    ]}}
    client = DwsClient(runner=_runner(payload))
    watch_todos.run(client=client, now=now)
    out = capsys.readouterr().out
    assert "stateful-watch / todos" in out
    assert "first_alert" in out
    assert "t1" in out


def test_second_run_suppresses_already_alerted(isolated_home, capsys):
    created_ms = 0
    payload = {"result": {"todoCards": [
        {"taskId": "t1", "subject": "写周报", "createdTime": created_ms, "finalStatusStage": 2, "priority": 40, "dueTime": None},
    ]}}
    client = DwsClient(runner=_runner(payload))
    watch_todos.run(client=client, now=8 * DAY)
    capsys.readouterr()
    watch_todos.run(client=client, now=9 * DAY)
    out = capsys.readouterr().out
    assert out == ""


def test_reminder_interval_elapsed_emits_reminded_1(isolated_home, capsys):
    payload = {"result": {"todoCards": [
        {"taskId": "t1", "subject": "写周报", "createdTime": 0, "finalStatusStage": 2, "priority": 40, "dueTime": None},
    ]}}
    client = DwsClient(runner=_runner(payload))
    watch_todos.run(client=client, now=8 * DAY)
    capsys.readouterr()
    watch_todos.run(client=client, now=8 * DAY + 3 * DAY)
    out = capsys.readouterr().out
    assert "reminded_1" in out


def test_dws_failure_empty_stdout(isolated_home, capsys):
    def failing(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="auth")
    client = DwsClient(runner=failing)
    rc = watch_todos.run(client=client, now=8 * DAY)
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_state_file_created_under_hermes_home(isolated_home, capsys):
    payload = {"result": {"todoCards": [
        {"taskId": "t1", "subject": "写周报", "createdTime": 0, "finalStatusStage": 2, "priority": 40, "dueTime": None},
    ]}}
    client = DwsClient(runner=_runner(payload))
    watch_todos.run(client=client, now=8 * DAY)
    sfile = isolated_home / "dingtalk-extensions" / "state" / "todos.jsonl"
    assert sfile.exists()
    rows = list(load_rows(sfile))
    assert len(rows) == 1 and rows[0]["todo_id"] == "t1" and rows[0]["stage"] == "first_alert"
