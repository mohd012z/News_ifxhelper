from __future__ import annotations
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

STATUSES = {"PASS", "WARN", "FAIL", "UNKNOWN"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class DiagnosticResult:
    check: str
    status: str
    sourceAt: str | None = None
    checkedAt: str = field(default_factory=utc_now)
    details: str = ""
    evidence: list[Any] = field(default_factory=list)
    recommendedAction: str | None = None

    def __post_init__(self) -> None:
        if self.status not in STATUSES:
            raise ValueError(f"invalid diagnostic status: {self.status}")
        if not self.check:
            raise ValueError("check is required")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def result(check: str, status: str, **kwargs: Any) -> DiagnosticResult:
    return DiagnosticResult(check=check, status=status, **kwargs)


def exit_code(results: list[DiagnosticResult]) -> int:
    if any(r.status == "FAIL" for r in results):
        return 1
    if any(r.status == "UNKNOWN" for r in results):
        return 2
    return 0
