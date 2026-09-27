from __future__ import annotations
from collections import defaultdict
from tools.py.lib.result import DiagnosticResult, result


def inspect(workflows: list[dict]) -> list[DiagnosticResult]:
    writers=[w for w in workflows if w.get('writes')]
    groups={str(w.get('group') or '') for w in writers}
    missing=[w.get('name') for w in writers if not w.get('group')]
    owners=defaultdict(list)
    for w in writers:
        for path in w.get('writes') or []: owners[path].append(w.get('name'))
    duplicate_owners={k:v for k,v in owners.items() if len(v)>1}
    # All production writers target one git branch. Different concurrency groups can
    # run simultaneously and race at git push even when they write different files.
    serialization_bad=len(groups)>1 or bool(missing)
    return [
      result('cron.writer_serialization','FAIL' if serialization_bad else 'PASS',evidence=[{'groups':sorted(groups),'missing':missing}],recommendedAction='Use one shared production-writer concurrency group and rebase before push.' if serialization_bad else None),
      result('cron.output_ownership','FAIL' if duplicate_owners else 'PASS',evidence=[duplicate_owners])
    ]
