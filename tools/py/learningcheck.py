from __future__ import annotations
from collections import Counter, defaultdict
from tools.py.lib.result import DiagnosticResult, result
from tools.py.lib.timeframes import exact_next, parse_utc

MIN_SAMPLES = 20


def inspect(rows: list[dict]) -> list[DiagnosticResult]:
    out: list[DiagnosticResult] = []
    ids = [str(r.get("id")) for r in rows if r.get("id") is not None]
    dup = [k for k, v in Counter(ids).items() if v > 1]
    out.append(result("learning.duplicate_ids", "FAIL" if dup else "PASS", evidence=dup))
    wrong, leakage, bad_publish = [], [], []
    buckets: dict[str, list[bool]] = defaultdict(list)
    for r in rows:
        created, settled = r.get("createdAt"), r.get("settledAt")
        if created and settled and parse_utc(settled) < parse_utc(created):
            leakage.append(r.get("id"))
        if r.get("status") == "SETTLED" and r.get("candleTime") and r.get("tf"):
            expected = exact_next(r["candleTime"], r["tf"])
            actual = r.get("settlementCandleTime") or r.get("nextCandleTime")
            if actual and parse_utc(actual) != parse_utc(expected):
                wrong.append({"id": r.get("id"), "expected": expected, "actual": actual})
        if r.get("publishable") is True and int(r.get("sampleSize") or 0) < MIN_SAMPLES:
            bad_publish.append(r.get("id"))
        if r.get("status") == "SETTLED" and r.get("confidence") is not None and r.get("correct") is not None:
            c = max(0, min(99, int(float(r["confidence"]))))
            label = f"{(c//10)*10:02d}-{(c//10)*10+9:02d}"
            buckets[label].append(bool(r["correct"]))
    out.append(result("learning.exact_next", "FAIL" if wrong else "PASS", evidence=wrong))
    out.append(result("learning.leakage", "FAIL" if leakage else "PASS", evidence=leakage))
    out.append(result("learning.sample_gate", "FAIL" if bad_publish else "PASS", evidence=bad_publish))
    calibration = {k: {"samples": len(v), "accuracyPct": round(sum(v)/len(v)*100, 1)} for k, v in sorted(buckets.items())}
    out.append(result("learning.calibration", "PASS", evidence=[calibration]))
    return out
