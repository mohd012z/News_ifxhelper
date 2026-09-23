# Polyglot Doctor, Research and Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent Python doctor/research CLI to cross-check the green Node.js Intelligence-360 pipeline, then introduce an optional C++ accelerator only where deterministic equivalence and profiling justify it.

**Architecture:** Node.js remains the production authority and sole writer of production intelligence. Python reads persisted snapshots and fixtures, independently validates time/data/learning/sync behavior, and emits normalized diagnostics; research uses chronological walk-forward evaluation. C++ is an optional deterministic compute backend behind fixture-equivalence and benchmark gates and never fetches data or creates trading signals independently.

**Tech Stack:** Node.js 22/CommonJS, Python 3.11+ standard library first, JSON/JSONL, GitHub Actions, optional C++17/CMake.

**Spec:** `docs/superpowers/specs/2026-09-23-polyglot-doctor-research-runtime.md`

## Global Constraints
- Node.js remains the production Intelligence-360 authority.
- Python/C++ must never silently overwrite production snapshots or learning history.
- Cross-language disagreement becomes diagnostic/conflict evidence and can never increase confidence.
- Python CLI exit codes: `0` pass, `1` diagnostic failure, `2` missing/insufficient data, `3` usage/configuration error.
- Missing or stale evidence produces `UNKNOWN/MISSING/STALE`, never an invented direction.
- Research must be chronological and prevent future-data leakage.
- C++ requires deterministic equivalence, documented numeric tolerance, representative benchmark benefit, graceful absence fallback, and no network/secrets handling.

## Review Focus
1. Python must detect a recent fetch containing an old source candle as stale.
2. M30 predictions may settle only on the exact +30-minute candle.
3. Python must identify duplicate deterministic learning IDs and overdue pending records.
4. A cached APK snapshot must retain its original source timestamp and be marked stale/offline when refresh fails.
5. Walk-forward code must never use validation-period outcomes to calibrate an earlier prediction.
6. C++ results must match reference fixtures before performance is considered.

## File Structure

**Create initially**
- `tools/py/ifx.py` — CLI entry point and exit-code aggregation.
- `tools/py/doctor.py` — deep-doctor orchestration only.
- `tools/py/candles.py` — OHLC closure, gaps, duplicates, boundaries, resampling checks.
- `tools/py/newscheck.py` — event/revision/checkpoint integrity.
- `tools/py/learningcheck.py` — IDs, exact settlement, sample/calibration/leakage checks.
- `tools/py/croncheck.py` — workflow ownership/freshness/schedule checks.
- `tools/py/syncdoctor.py` — snapshot/manifest/web synchronization checks.
- `tools/py/apkdoctor.py` — packaged/cache timestamp diagnostics.
- `tools/py/walkforward.py` — chronological research evaluator.
- `tools/py/benchmark.py` — cross-language equivalence and performance harness.
- `tools/py/lib/io.py`, `timeframes.py`, `schema.py`, `result.py`, `statistics.py`.
- `test/py/test_result.py`, `test_timeframes.py`, `test_candles.py`, `test_learningcheck.py`, `test_newscheck.py`, `test_syncdoctor.py`, `test_walkforward.py`.
- `.github/workflows/python-doctor.yml`.

**Create only after profiling gate**
- `native/research/CMakeLists.txt`
- `native/research/rolling_indicators.cpp`
- `native/research/signature_search.cpp`
- `native/research/walkforward_kernel.cpp`

**Modify**
- `package.json` — expose convenience scripts without making Python a Node runtime dependency.
- `.github/workflows/pr-validation.yml` — add a Python doctor verification stage only after Node validation remains green.
- `build-data-manifest.js` if required to expose doctor-consumed generated snapshots consistently.

---

### Task 1: Python Diagnostic Result Contract and CLI Skeleton

**Files:** create `tools/py/lib/result.py`, `tools/py/ifx.py`, `test/py/test_result.py`.

- [ ] Write a failing unittest for normalized `PASS/WARN/FAIL/UNKNOWN` results, JSON serialization and aggregate exit codes.
- [ ] Run `python -m unittest test.py.test_result` and verify failure because modules do not exist.
- [ ] Implement a small immutable-ish result factory containing `check`, `status`, `sourceAt`, `checkedAt`, `details`, `evidence`, `recommendedAction`.
- [ ] Implement CLI argument parsing with `doctor`, `sources`, `cron`, `candles`, `bbma`, `news`, `learning`, `conflicts`, `sync`, `apk`, `walkforward`, `benchmark`; unimplemented commands return explicit diagnostic status rather than stack traces.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add Python doctor result contract and CLI`.

### Task 2: Timeframe and Safe JSON Foundation

**Files:** create `tools/py/lib/io.py`, `tools/py/lib/timeframes.py`, `tools/py/lib/schema.py`, `test/py/test_timeframes.py`.

- [ ] Write failing tests for M1/M5/M15/M30/H1/H4/D1/W1 durations, exact-next timestamps, invalid JSON, missing files and required-key checks.
- [ ] Implement UTC-safe parsing and exact-next-candle helpers; do not approximate MN1 with these helpers for settlement.
- [ ] Implement read-only JSON/JSONL loaders that return diagnostics rather than modifying corrupt files.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add Python timeframe and safe snapshot IO`.

### Task 3: Independent OHLC/Candle Doctor

**Files:** create `tools/py/candles.py`, `test/py/test_candles.py`.

- [ ] Create fixtures containing exact M1 data, duplicate timestamps, gaps, forming candle, stale sourceAt and incorrect M30 bucket boundaries.
- [ ] Write failing tests expecting detection of every defect.
- [ ] Implement monotonicity, duplicate, gap, OHLC numeric/invariant, closed/forming, source-age and exact timeframe-boundary checks.
- [ ] Add independent M1→M5/M15/M30/H1/H4 aggregation for fixture cross-checks against Node output.
- [ ] Ensure mismatches produce `FAIL/MISMATCH` evidence and never rewrite the Node snapshot.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add independent Python OHLC doctor`.

### Task 4: Learning Doctor and Exact Settlement Audit

**Files:** create `tools/py/learningcheck.py`, `test/py/test_learningcheck.py`.

- [ ] Write fixtures for duplicate IDs, valid M30 +30m settlement, invalid +60m settlement, mutated settled record, overdue pending record, <20 sample publication and confidence/calibration drift.
- [ ] Write failing tests for all cases.
- [ ] Implement deterministic-ID recomputation compatible with documented Node identity fields, exact-next settlement audit and sample gate validation.
- [ ] Add leakage checks ensuring observation creation precedes settlement/outcome timestamps.
- [ ] Add calibration diagnostics comparing model-confidence buckets with observed accuracy without turning either into a trading recommendation.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add Python one-step learning doctor`.

### Task 5: News/Economic Reaction Doctor

**Files:** create `tools/py/newscheck.py`, `test/py/test_newscheck.py`.

- [ ] Write fixtures for duplicated event IDs, revised previous values, missing actual/forecast, late cron, and M1/M5/M15/M30/H1/H4 checkpoints.
- [ ] Verify a missing M30 checkpoint cannot be filled by the first later candle.
- [ ] Implement event chronology, field-presence, revision preservation, deterministic-ID and checkpoint-time checks.
- [ ] Cross-check event state classification (`PRE_NEWS/NEWS_RELEASE/POST_NEWS/NORMAL`) against persisted timestamps.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add Python news and reaction doctor`.

### Task 6: Cron, Snapshot and APK Synchronization Doctor

**Files:** create `tools/py/croncheck.py`, `tools/py/syncdoctor.py`, `tools/py/apkdoctor.py`, `test/py/test_syncdoctor.py`.

- [ ] Create fixtures for fresh/stale workflows, duplicate output owners, out-of-order generatedAt/sourceAt, stale manifest entries and cached APK data.
- [ ] Write failing tests proving current device/check time cannot replace source generation time.
- [ ] Implement expected-output ownership map and freshness thresholds for BBMA watch, Intelligence-360, learning health and weekly/monthly aggregation.
- [ ] Implement manifest/snapshot coherence checks and APK/web cache-age classification.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add cron sync and APK doctors`.

### Task 7: Deep Doctor Orchestration

**Files:** create `tools/py/doctor.py`; modify `tools/py/ifx.py`.

- [ ] Write an integration fixture directory representing a healthy repository snapshot and another with stale OHLC + duplicate learning ID + stale APK snapshot.
- [ ] Add tests that `doctor --deep --json` aggregates all subsystem evidence and returns exit 0 for healthy, exit 1 for hard failures, exit 2 when required data is absent.
- [ ] Implement read-only orchestration with concise human output and complete JSON output.
- [ ] Add `--path` to point the doctor at fixture/repository roots without hardcoded working-directory assumptions.
- [ ] Run all Python tests and verify PASS.
- [ ] Commit `feat: add deep Python repository doctor`.

### Task 8: Node ↔ Python Cross-Language Fixtures

**Files:** create `test/fixtures/cross-language/*.json`; create or modify small Node fixture exporter if needed; extend Python tests.

- [ ] Define canonical fixtures for timeframe boundaries, M30 aggregation, BB/EMA/ATR numeric values, deterministic learning identity and news checkpoint timestamps.
- [ ] Generate expected reference outputs from existing green Node engines and commit them as fixtures with schema/version metadata.
- [ ] Make Python recompute deterministic categories/timestamps exactly and numeric values within explicit tolerances.
- [ ] Fail on disagreement; do not select the more favorable result.
- [ ] Run Node tests and Python tests together.
- [ ] Commit `test: add Node Python cross-language equivalence fixtures`.

### Task 9: CI Integration

**Files:** create `.github/workflows/python-doctor.yml`; modify `.github/workflows/pr-validation.yml`, `package.json`.

- [ ] Add convenience scripts such as `doctor:py` and `test:py` that invoke system Python but do not install Python through npm.
- [ ] Add Python 3.11 setup after the existing Node deterministic gates.
- [ ] Run `python -m unittest discover -s test/py -p 'test_*.py'`.
- [ ] Run `python tools/py/ifx.py doctor --deep --json` against repository snapshots; missing optional runtime data may warn, but schema/logic defects fail.
- [ ] Preserve the existing Node tests as the first blocking authority.
- [ ] Trigger PR validation and inspect actual logs before claiming green.
- [ ] Commit `ci: add independent Python doctor verification`.

### Task 10: Walk-Forward Research Laboratory

**Files:** create `tools/py/walkforward.py`, `tools/py/lib/statistics.py`, `test/py/test_walkforward.py`.

- [ ] Write synthetic chronological observations where future leakage would produce unrealistically perfect results.
- [ ] Write failing test requiring train/calibrate/validate windows to be strictly ordered and non-overlapping.
- [ ] Implement rolling chronological windows and report sample count, coverage/abstention, directional accuracy, balanced accuracy where meaningful, confidence buckets and calibration error.
- [ ] Group optional reports by timeframe, news mode, event category, BB location, squeeze and BBMA pattern while preserving minimum-sample gates.
- [ ] Emit research output separately under `research/` or a temporary artifact; never overwrite production data.
- [ ] Run tests and verify PASS.
- [ ] Commit `feat: add walk-forward intelligence research lab`.

### Task 11: Performance Profile Before C++

**Files:** create `tools/py/benchmark.py`.

- [ ] Benchmark representative 10k/100k/1m-candle rolling calculations and signature matching in existing Node and Python reference paths.
- [ ] Record wall-clock duration, input size and environment metadata.
- [ ] Define the C++ entry gate in the benchmark report: native implementation is justified only for a measured bottleneck with material expected benefit; do not create native code merely because C++ is available.
- [ ] Commit `perf: profile research workloads before native acceleration`.

### Task 12: Optional C++17 Accelerator — Conditional

**Files:** only if Task 11 justifies it: create `native/research/CMakeLists.txt`, `rolling_indicators.cpp`, `signature_search.cpp`, `walkforward_kernel.cpp` and equivalence tests.

- [ ] Implement one proven bottleneck first, not all three kernels at once.
- [ ] Use file/stdin JSON or a minimal deterministic interface; no networking, credentials or production writes.
- [ ] Verify exact categorical/timestamp equivalence and documented floating-point tolerance against canonical fixtures.
- [ ] Benchmark again and retain C++ only if it materially improves the profiled workload.
- [ ] Ensure Python/Node gracefully fall back when the native executable is absent.
- [ ] Commit `perf: add verified native research accelerator` only when all gates pass.

### Task 13: Final Cross-Check

- [ ] Run existing `npm test` and confirm zero failures.
- [ ] Run Node syntax/manifest validation.
- [ ] Run all Python unittests.
- [ ] Run `python tools/py/ifx.py doctor --deep --json`.
- [ ] Run deliberate bad fixtures and confirm stale, duplicate, wrong-next-candle and leakage defects are detected.
- [ ] If C++ exists, build with CMake and run equivalence + benchmark tests.
- [ ] Trigger PR CI and inspect logs.
- [ ] Verify no Python/C++ command modifies production JSON during diagnostic runs.
- [ ] Update PR #4 description/checklist with verified results; do not merge solely because files exist.

## Acceptance Checklist
- [ ] Node production validation remains green.
- [ ] Python doctor independently detects stale candles, duplicates, gaps and forming candles.
- [ ] Python verifies exact M30 settlement and sample-size gating.
- [ ] News checkpoint timing is independently audited.
- [ ] Cron/output ownership and snapshot freshness are visible.
- [ ] APK stale/offline data is detected without falsifying timestamps.
- [ ] Cross-language deterministic fixtures agree.
- [ ] Walk-forward validation prevents future leakage.
- [ ] C++ is absent unless profiling justifies it; if present, equivalence is proven.
- [ ] Diagnostics remain read-only and cannot silently alter production intelligence.
