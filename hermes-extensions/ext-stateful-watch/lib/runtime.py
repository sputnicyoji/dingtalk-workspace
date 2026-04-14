from __future__ import annotations

import os
from pathlib import Path


def hermes_home() -> Path:
    v = os.environ.get("HERMES_HOME")
    return Path(v) if v else Path.home() / ".hermes"


def state_dir() -> Path:
    return hermes_home() / "dingtalk-extensions" / "state"


def config_path() -> Path:
    return hermes_home() / "dingtalk-extensions" / "config" / "stateful_watch.yaml"
