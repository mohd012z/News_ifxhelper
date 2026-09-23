from __future__ import annotations
from datetime import datetime, timezone
from tools.py.lib.result import DiagnosticResult, result
from tools.py.lib.timeframes import parse_utc


def inspect(snapshots: list[dict], now: datetime | None=None, max_age_seconds: int=1800) -> list[DiagnosticResult]:
    n=now or datetime.now(timezone.utc)
    ids={str(x.get('generationId')) for x in snapshots if x.get('generationId')}
    missing_lineage=[x.get('name') for x in snapshots if not x.get('generationId')]
    lineage_bad=len(ids)>1
    ages=[]; stale=[]; invalid=[]
    for x in snapshots:
        ts=x.get('sourceGeneratedAt') or x.get('generatedAt')
        if not ts:
            invalid.append(x.get('name')); continue
        try:
            age=max(0,(n-parse_utc(ts)).total_seconds()); ages.append({'name':x.get('name'),'ageSeconds':int(age)})
            if age>max_age_seconds: stale.append(x.get('name'))
        except (TypeError,ValueError): invalid.append(x.get('name'))
    return [
      result('sync.lineage','FAIL' if lineage_bad else ('WARN' if missing_lineage else 'PASS'),evidence=[{'generationIds':sorted(ids),'missing':missing_lineage}]),
      result('sync.freshness','FAIL' if stale else ('UNKNOWN' if invalid else 'PASS'),evidence=ages+[{'stale':stale,'invalid':invalid}])
    ]
