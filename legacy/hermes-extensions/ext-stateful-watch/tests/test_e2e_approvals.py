from __future__ import annotations

import json
import subprocess

import pytest

import scripts.watch_approvals as watch_approvals
from lib.dws_client import DwsClient
from lib.state import load_rows


def _runner_queue(responses: list[dict]):
    idx = {"i": 0}

    def _run(cmd, timeout):
        resp = responses[idx["i"]]
        idx["i"] += 1
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(resp), stderr="")

    return _run


def _pending_item(pid, status="pending", title="加班申请"):
    return {
        "processInstanceId": pid,
        "title": title,
        "status": status,
        "createTime": 1776000000000,
    }


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    yield tmp_path


def test_first_run_new_items_no_event(isolated_home, capsys):
    responses = [{"result": {"processInstanceList": [_pending_item("p1")]}}]
    client = DwsClient(runner=_runner_queue(responses))
    watch_approvals.run(client=client, now=1776000000)
    assert capsys.readouterr().out == ""


def test_second_run_transition_emits_event(isolated_home, capsys):
    responses_1 = [{"result": {"processInstanceList": [_pending_item("p1", status="pending")]}}]
    watch_approvals.run(client=DwsClient(runner=_runner_queue(responses_1)), now=1776000000)
    capsys.readouterr()
    responses_2 = [{"result": {"processInstanceList": [_pending_item("p1", status="approved")]}}]
    watch_approvals.run(client=DwsClient(runner=_runner_queue(responses_2)), now=1776003600)
    out = capsys.readouterr().out
    assert "p1" in out
    assert "pending -> approved" in out


def test_timeout_emits_warn_and_dedups(isolated_home, capsys):
    responses_1 = [{"result": {"processInstanceList": [_pending_item("p1")]}}]
    watch_approvals.run(client=DwsClient(runner=_runner_queue(responses_1)), now=1776000000)
    capsys.readouterr()
    responses_2 = [{"result": {"processInstanceList": [_pending_item("p1")]}}]
    watch_approvals.run(
        client=DwsClient(runner=_runner_queue(responses_2)),
        now=1776000000 + 5 * 3600,
    )
    out = capsys.readouterr().out
    assert "p1" in out and "pending > 4h" in out
    capsys.readouterr()
    responses_3 = [{"result": {"processInstanceList": [_pending_item("p1")]}}]
    watch_approvals.run(
        client=DwsClient(runner=_runner_queue(responses_3)),
        now=1776000000 + 6 * 3600,
    )
    assert capsys.readouterr().out == ""


def test_dws_failure_emits_empty(isolated_home, capsys):
    def failing(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="auth")
    client = DwsClient(runner=failing)
    rc = watch_approvals.run(client=client, now=1776000000)
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_state_file_tracks_snapshot_and_alerted(isolated_home, capsys):
    responses_1 = [{"result": {"processInstanceList": [_pending_item("p1", status="pending")]}}]
    watch_approvals.run(client=DwsClient(runner=_runner_queue(responses_1)), now=1776000000)
    responses_2 = [{"result": {"processInstanceList": [_pending_item("p1", status="approved")]}}]
    watch_approvals.run(client=DwsClient(runner=_runner_queue(responses_2)), now=1776003600)
    sfile = isolated_home / "dingtalk-extensions" / "state" / "approvals.jsonl"
    rows = list(load_rows(sfile))
    kinds = [r.get("kind") for r in rows]
    assert kinds.count("snapshot") == 2
    assert "alerted" in kinds
