from __future__ import annotations
from datetime import datetime, timezone
from tools.py.lib.result import DiagnosticResult, result
from tools.py.lib.timeframes import MINUTES, on_boundary, parse_utc


def inspect(candles: list[dict], tf: str = "M1", source_at: str | None = None, max_age_seconds: int = 1800, now: datetime | None = None) -> list[DiagnosticResult]:
    out: list[DiagnosticResult] = []
    if tf not in MINUTES:
        return [result("candles.timeframe", "FAIL", details=f"unsupported {tf}")]
    if not candles:
        return [result("candles.presence", "UNKNOWN", details="no candles")]
    parsed = []
    invalid = []
    for i, c in enumerate(candles):
        try:
            t = parse_utc(c["time"])
            o, h, l, cl = (float(c[k]) for k in ("open", "high", "low", "close"))
            if h < max(o, l, cl) or l > min(o, h, cl):
                invalid.append(i)
            parsed.append((t, c))
        except (KeyError, TypeError, ValueError):
            invalid.append(i)
    out.append(result("candles.ohlc", "FAIL" if invalid else "PASS", details=f"invalid={invalid}"))
    times = [x[0] for x in parsed]
    duplicates = len(times) - len(set(times))
    out.append(result("candles.duplicates", "FAIL" if duplicates else "PASS", details=f"duplicates={duplicates}"))
    ordered = all(a < b for a, b in zip(times, times[1:]))
    out.append(result("candles.monotonic", "PASS" if ordered else "FAIL"))
    step = MINUTES[tf] * 60
    gaps = []
    for a, b in zip(times, times[1:]):
        delta = int((b-a).total_seconds())
        if delta > step:
            gaps.append({"from": a.isoformat(), "to": b.isoformat(), "seconds": delta})
    out.append(result("candles.gaps", "WARN" if gaps else "PASS", evidence=gaps, details=f"gaps={len(gaps)}"))
    bad_boundaries = [c["time"] for _, c in parsed if not on_boundary(c["time"], tf)]
    out.append(result("candles.boundary", "FAIL" if bad_boundaries else "PASS", evidence=bad_boundaries[:20]))
    if source_at:
        n = now or datetime.now(timezone.utc)
        age = max(0, (n - parse_utc(source_at)).total_seconds())
        out.append(result("candles.freshness", "PASS" if age <= max_age_seconds else "FAIL", sourceAt=source_at, details=f"ageSeconds={int(age)}"))
    return out


def aggregate(candles: list[dict], tf: str) -> list[dict]:
    mins = MINUTES[tf]
    buckets: dict[int, list[dict]] = {}
    for c in candles:
        dt = parse_utc(c["time"])
        key = int(dt.timestamp() // 60 // mins * mins)
        buckets.setdefault(key, []).append(c)
    out = []
    for key in sorted(buckets):
        rows = buckets[key]
        out.append({"time": datetime.fromtimestamp(key*60, timezone.utc).isoformat().replace("+00:00", "Z"), "open": rows[0]["open"], "high": max(float(x["high"]) for x in rows), "low": min(float(x["low"]) for x in rows), "close": rows[-1]["close"]})
    return out
