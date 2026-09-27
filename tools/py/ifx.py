from __future__ import annotations
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.py.lib.io import read_json
from tools.py.lib.result import DiagnosticResult, exit_code, result
from tools.py import candles, learningcheck, newscheck, syncdoctor

COMMANDS = ("doctor", "sources", "cron", "candles", "bbma", "news", "learning", "conflicts", "sync", "apk", "walkforward", "benchmark")


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="ifx", description="Read-only News_ifxhelper diagnostic CLI")
    p.add_argument("command", choices=COMMANDS)
    p.add_argument("--path", default=str(ROOT))
    p.add_argument("--tf", default="M30")
    p.add_argument("--deep", action="store_true")
    p.add_argument("--json", action="store_true", dest="as_json")
    return p


def load_rows(root: Path, name: str) -> tuple[list[dict] | None, DiagnosticResult | None]:
    value, error = read_json(root / "data" / name)
    if error:
        return None, result(f"input.{name}", "UNKNOWN", details=error)
    if not isinstance(value, list):
        return None, result(f"input.{name}", "FAIL", details="expected JSON array")
    return value, None


def snapshot(root: Path, name: str) -> dict:
    value, error = read_json(root / name)
    if error or not isinstance(value, dict):
        return {'name': name, 'readError': error or 'expected object'}
    return {'name': name, **value}


def run(args: argparse.Namespace) -> list[DiagnosticResult]:
    root = Path(args.path).resolve()
    if args.command == "learning":
        rows, err = load_rows(root, "bbma-learning.json")
        return [err] if err else learningcheck.inspect(rows or [])
    if args.command == "candles":
        value, error = read_json(root / "data" / "ohlc-backfill.json")
        if error:
            return [result("input.ohlc", "UNKNOWN", details=error)]
        rows = value.get("candles", value) if isinstance(value, dict) else value
        if not isinstance(rows, list):
            return [result("input.ohlc", "FAIL", details="candles array not found")]
        return candles.inspect(rows, args.tf)
    if args.command == "news":
        rows, err = load_rows(root, "news-level-reaction-history.json")
        return [err] if err else newscheck.inspect(rows or [])
    if args.command in ("sync", "apk"):
        names=("data/bbma-watch.json","data/bbma-performance.json","data/agent-health.json","data/intelligence-360.json")
        return syncdoctor.inspect([snapshot(root,n) for n in names])
    if args.command == "doctor":
        out=[]
        rows, err = load_rows(root, "bbma-learning.json")
        out += [err] if err else learningcheck.inspect(rows or [])
        out += syncdoctor.inspect([snapshot(root,n) for n in ("data/bbma-watch.json","data/bbma-performance.json","data/agent-health.json","data/intelligence-360.json")])
        return out
    return [result(f"command.{args.command}", "UNKNOWN", details="planned diagnostic not implemented yet")]


def main() -> int:
    args = parser().parse_args()
    results = run(args)
    if args.as_json:
        print(json.dumps({"results": [r.to_dict() for r in results], "exitCode": exit_code(results)}, indent=2))
    else:
        for r in results:
            print(f"{r.status:7} {r.check} {r.details}".rstrip())
    return exit_code(results)


if __name__ == "__main__":
    raise SystemExit(main())
