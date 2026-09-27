from __future__ import annotations
import json
from pathlib import Path
from typing import Any


def read_json(path: str | Path) -> tuple[Any | None, str | None]:
    p = Path(path)
    if not p.exists():
        return None, "MISSING_FILE"
    try:
        return json.loads(p.read_text(encoding="utf-8")), None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, f"INVALID_JSON:{exc.__class__.__name__}"


def read_jsonl(path: str | Path) -> tuple[list[Any] | None, str | None]:
    p = Path(path)
    if not p.exists():
        return None, "MISSING_FILE"
    rows = []
    try:
        for number, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if line.strip():
                rows.append(json.loads(line))
        return rows, None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, f"INVALID_JSONL:{number}:{exc.__class__.__name__}"


def require_keys(value: Any, keys: list[str]) -> list[str]:
    if not isinstance(value, dict):
        return list(keys)
    return [key for key in keys if key not in value]
