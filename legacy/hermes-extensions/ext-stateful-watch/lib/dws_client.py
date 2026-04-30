from __future__ import annotations

import json
import subprocess
from typing import Callable, Optional

Runner = Callable[[list[str], float], subprocess.CompletedProcess]


class DwsCallFailed(RuntimeError):
    pass


def _default_runner(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False, encoding="utf-8")


class DwsClient:
    def __init__(
        self,
        runner: Optional[Runner] = None,
        timeout: float = 30.0,
        binary: str = "dws",
    ):
        self._run = runner or _default_runner
        self._timeout = timeout
        self._binary = binary

    def invoke(self, args: list[str]) -> dict:
        cmd = [self._binary, *args, "--format", "json"]
        try:
            cp = self._run(cmd, self._timeout)
        except subprocess.TimeoutExpired as e:
            raise DwsCallFailed(f"timeout after {self._timeout}s running {args[:3]}") from e
        if cp.returncode != 0:
            head = (cp.stderr or "").strip()[:200]
            raise DwsCallFailed(f"exit {cp.returncode}: {head}")
        try:
            return json.loads(cp.stdout)
        except json.JSONDecodeError as e:
            head = (cp.stdout or "")[:120]
            raise DwsCallFailed(f"bad json from dws: {e.msg}; head={head!r}") from e
