from __future__ import annotations
from datetime import datetime, timedelta, timezone

MINUTES = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440, "W1": 10080}


def parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("timestamp required")
    text = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def duration(tf: str) -> timedelta:
    if tf not in MINUTES:
        raise ValueError(f"unsupported fixed timeframe: {tf}")
    return timedelta(minutes=MINUTES[tf])


def exact_next(value: str, tf: str) -> str:
    return iso_utc(parse_utc(value) + duration(tf))


def on_boundary(value: str, tf: str) -> bool:
    dt = parse_utc(value)
    mins = MINUTES.get(tf)
    if mins is None:
        return False
    epoch_min = int(dt.timestamp() // 60)
    return dt.second == 0 and dt.microsecond == 0 and epoch_min % mins == 0
