import json
import subprocess

import pytest

from lib.dws_client import DwsClient, DwsCallFailed


def _fake_ok(payload):
    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
    return _run


def _fake_fail(code=1, stderr="boom"):
    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, code, stdout="", stderr=stderr)
    return _run


def _fake_bad_json():
    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 0, stdout="not json", stderr="")
    return _run


def _fake_timeout():
    def _run(cmd, timeout):
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=timeout)
    return _run


def test_invoke_success_returns_parsed_json():
    c = DwsClient(runner=_fake_ok({"items": [1, 2]}))
    assert c.invoke(["oa", "approval", "list-pending"]) == {"items": [1, 2]}


def test_invoke_passes_format_json_flag():
    captured = {}

    def runner(cmd, timeout):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

    c = DwsClient(runner=runner)
    c.invoke(["todo", "task", "list"])
    assert "--format" in captured["cmd"]
    assert "json" in captured["cmd"]
    assert captured["cmd"][0] == "dws"


def test_invoke_nonzero_raises_dws_call_failed():
    c = DwsClient(runner=_fake_fail(code=2, stderr="auth error"))
    with pytest.raises(DwsCallFailed) as exc:
        c.invoke(["oa", "approval", "list-pending"])
    assert "exit 2" in str(exc.value)
    assert "auth error" in str(exc.value)


def test_invoke_bad_json_raises():
    c = DwsClient(runner=_fake_bad_json())
    with pytest.raises(DwsCallFailed) as exc:
        c.invoke(["todo", "task", "list"])
    assert "bad json" in str(exc.value).lower()


def test_invoke_timeout_raises():
    c = DwsClient(runner=_fake_timeout(), timeout=0.1)
    with pytest.raises(DwsCallFailed) as exc:
        c.invoke(["todo", "task", "list"])
    assert "timeout" in str(exc.value).lower()


def test_invoke_custom_binary():
    captured = {}

    def runner(cmd, timeout):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

    c = DwsClient(runner=runner, binary="/opt/custom/dws")
    c.invoke(["todo", "task", "list"])
    assert captured["cmd"][0] == "/opt/custom/dws"
