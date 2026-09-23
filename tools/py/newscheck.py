from __future__ import annotations
from collections import Counter
from tools.py.lib.result import DiagnosticResult, result
from tools.py.lib.timeframes import exact_next, parse_utc

CHECKPOINTS=("M1","M5","M15","M30","H1","H4","D1","W1")


def inspect(rows: list[dict]) -> list[DiagnosticResult]:
    ids=[str(r.get('id')) for r in rows if r.get('id') is not None]
    dup=[k for k,v in Counter(ids).items() if v>1]
    bad_fields=[]; wrong=[]; missing=[]; chronology=[]
    for r in rows:
        event_at=r.get('eventAt')
        if not event_at:
            chronology.append({'id':r.get('id'),'reason':'MISSING_EVENT_TIME'}); continue
        try: event_dt=parse_utc(event_at)
        except (TypeError,ValueError):
            chronology.append({'id':r.get('id'),'reason':'INVALID_EVENT_TIME'}); continue
        if r.get('actual') is not None and r.get('forecast') is None:
            bad_fields.append({'id':r.get('id'),'reason':'ACTUAL_WITHOUT_FORECAST'})
        cps=r.get('checkpoints') or {}
        for tf,value in cps.items():
            if tf not in CHECKPOINTS: continue
            if value is None:
                missing.append({'id':r.get('id'),'tf':tf}); continue
            try:
                expected=parse_utc(exact_next(event_at,tf)); actual=parse_utc(value)
                if actual != expected:
                    wrong.append({'id':r.get('id'),'tf':tf,'expected':expected.isoformat(),'actual':actual.isoformat()})
                if actual <= event_dt:
                    chronology.append({'id':r.get('id'),'tf':tf,'reason':'NON_FUTURE_CHECKPOINT'})
            except (TypeError,ValueError):
                wrong.append({'id':r.get('id'),'tf':tf,'actual':value})
    return [
      result('news.duplicate_ids','FAIL' if dup else 'PASS',evidence=dup),
      result('news.fields','FAIL' if bad_fields else 'PASS',evidence=bad_fields),
      result('news.chronology','FAIL' if chronology else 'PASS',evidence=chronology),
      result('news.checkpoints','FAIL' if wrong else ('WARN' if missing else 'PASS'),evidence=wrong+missing,details=f'wrong={len(wrong)} missing={len(missing)}')
    ]
