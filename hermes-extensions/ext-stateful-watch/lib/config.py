from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "approvals": {
        "timeout_hours": 4,
        "roles_high_priority": ["上级", "客户"],
        "initiated_process_codes": [],
    },
    "reports": {
        "include_senders": [],
        "exclude_templates": [],
    },
    "todos": {
        "stale_days": 7,
        "reminder_interval_days": 3,
    },
}


def _deep_merge(base: dict, overlay: dict) -> dict:
    result = copy.deepcopy(base)
    for k, v in overlay.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def load_config(path: Path) -> dict:
    if not path.exists():
        return copy.deepcopy(DEFAULTS)
    try:
        import yaml
    except ImportError as e:
        raise RuntimeError(
            "PyYAML is required to load stateful_watch config. "
            "Install via `pip install PyYAML`."
        ) from e
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {path} must be a YAML mapping, got {type(data).__name__}")
    return _deep_merge(DEFAULTS, data)
