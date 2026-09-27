# Polyglot Doctor, Research and Runtime Specification

**Status:** Approved design, written specification stage
**Repository:** `mohd012z/News_ifxhelper`
**Branch:** `improve/bbma-dashboard-integration`
**Parent architecture:** Intelligence Agent Orchestration

## Purpose

Extend the now-green Node.js Intelligence-360 architecture with an independent Python diagnostic/research layer, a unified CLI, small single-purpose diagnostic modules, and an optional C++ acceleration layer for proven historical-compute bottlenecks. Node.js remains the production authority. Python independently verifies and researches. C++ may accelerate deterministic calculations but must never become an unobserved alternate signal engine.

## Success Criteria

1. One operator CLI can inspect sources, cron freshness, candles, BBMA state, news, learning, conflicts, synchronization, benchmarks and APK data freshness.
2. Python can independently cross-check persisted Node outputs and classify results as `VERIFIED`, `MISMATCH`, `STALE`, `MISSING`, `CONFLICT` or `UNKNOWN`.
3. Diagnostic modules remain small and independently testable rather than becoming a monolithic Python application.
4. Python never silently rewrites production intelligence output.
5. C++ is optional and is introduced only behind benchmark/equivalence gates for workloads where it materially outperforms Node/Python.
6. Historical research uses chronological walk-forward evaluation so future observations cannot leak into earlier predictions.
7. Existing Node CI remains authoritative and green throughout the migration.

## Authority Model

```text
Node.js production engine
        |
        +--> persisted evidence / snapshots
        |
        +--> Python doctor independently validates
        |         |
        |         +--> VERIFIED
        |         +--> MISMATCH -> conflict evidence
        |         +--> STALE/MISSING -> health evidence
        |
        +--> Python research / walk-forward lab
                  |
                  +--> optional C++ accelerator
```

No Python or C++ result may silently overwrite `intelligence-360.json`, `bbma-watch.json`, news data or production learning history. Cross-language disagreement is recorded and surfaced to the existing conflict/health system.

## Python Layout

```text
tools/py/
  ifx.py                 # CLI entry point
  doctor.py              # aggregate doctor
  candles.py             # OHLC continuity/closure/boundary checks
  newscheck.py           # event timestamps, revisions and reaction checkpoints
  learningcheck.py       # IDs, exact settlement, leakage, calibration
  croncheck.py           # expected schedule/freshness/output ownership
  syncdoctor.py          # snapshot IDs/timestamps/data-manifest coherence
  apkdoctor.py           # packaged/cached data freshness diagnostics
  walkforward.py         # chronological research validation
  benchmark.py           # Node/Python/C++ equivalence and speed harness
  lib/
    io.py
    timeframes.py
    schema.py
    result.py
    statistics.py
```

Each diagnostic returns a normalized result with `check`, `status`, `sourceAt`, `checkedAt`, `details`, `evidence`, and `recommendedAction`. Status is one of `PASS`, `WARN`, `FAIL`, `UNKNOWN`.

## CLI

Primary commands:

```text
python tools/py/ifx.py doctor
python tools/py/ifx.py doctor --deep
python tools/py/ifx.py sources
python tools/py/ifx.py cron
python tools/py/ifx.py candles --tf M30
python tools/py/ifx.py bbma --tf M30
python tools/py/ifx.py news
python tools/py/ifx.py learning
python tools/py/ifx.py conflicts
python tools/py/ifx.py sync
python tools/py/ifx.py apk
python tools/py/ifx.py walkforward
python tools/py/ifx.py benchmark
```

CLI exit codes: `0` all required checks pass, `1` diagnostic failure, `2` missing/insufficient data, `3` usage/configuration error. Human-readable output is default; `--json` emits machine-readable results for CI.

## Doctor Checks

### Market/OHLC
- timestamp parsing and monotonicity
- duplicates and gaps
- closed versus forming candles
- exact M5/M15/M30/H1/H4 boundaries
- resampling equivalence against persisted Node frames
- stale sourceAt despite recent fetchedAt
- provider disagreement and latency metadata

### News/Economic
- scheduled event timestamp
- actual/forecast/previous presence
- revision preservation
- deterministic event ID/dedupe
- pre/release/post-news state
- M1/M5/M15/M30/H1/H4 reaction checkpoint integrity
- missing checkpoints remain missing rather than substituted with later candles

### Learning
- deterministic observation IDs
- duplicate prediction detection
- exact-next-candle settlement
- no future-data leakage
- no settled record mutation
- confidence versus empirical accuracy calibration
- sample-size gate (`>=20`) enforcement
- pending observations that are overdue

### Cron/Sync
- output owner per workflow
- expected schedule and latest successful timestamp
- overlapping/stale writer detection
- snapshot generation ordering
- manifest contains current generated datasets
- APK/web snapshot timestamp is preserved instead of replaced with device time

## Walk-Forward Research

Research is chronological:

```text
TRAIN -> CALIBRATE -> VALIDATE FUTURE -> ROLL FORWARD -> REPEAT
```

Metrics include sample count, directional accuracy, balanced accuracy where appropriate, calibration error, confidence buckets, event/timeframe/pattern stratification, and coverage/abstention rate. Results must include the exact historical window and may not be promoted to production automatically.

## Optional C++ Layer

Proposed location:

```text
native/research/
  CMakeLists.txt
  rolling_indicators.cpp
  signature_search.cpp
  walkforward_kernel.cpp
```

Candidate workloads are rolling EMA/BB/ATR over large histories, historical signature matching, bootstrap/Monte-Carlo style research and parameter sweeps. C++ adoption requires:

1. deterministic fixture equivalence with reference implementation;
2. numerical tolerance documented per calculation;
3. benchmark showing material benefit on representative data;
4. graceful fallback when native binary is absent;
5. no network/API/secrets handling in native code.

## Cross-Language Verification

For deterministic calculations, fixtures are shared. Node and Python must match exact categorical states and timestamps; numeric values use explicit tolerances. If C++ is enabled, it must match the same fixtures. A mismatch fails the cross-check and creates diagnostic evidence rather than selecting whichever implementation appears more favorable.

## CI Integration

Add a Python diagnostic job after the existing green Node deterministic job. Initial CI uses only the Python standard library where practical to minimize dependencies. C++ build/benchmark is a separate optional job and does not block normal application builds until equivalence is proven stable.

Target sequence:

```text
Node deterministic tests
 -> Node syntax/manifest
 -> Python doctor unit tests
 -> Python cross-language fixture checks
 -> Python deep doctor on repository snapshots
 -> optional C++ build/equivalence/benchmark
```

## Safety and Failure Behavior

- Missing evidence yields `UNKNOWN/MISSING`, not an invented direction.
- Stale evidence is never upgraded merely because a file was recently fetched.
- Python/C++ disagreement cannot increase confidence.
- Doctor/research tools do not alter live production state unless a future explicit repair command is separately designed and approved.
- Research outputs are descriptive evidence, not automatic trading instructions.

## Delivery Phases

1. Python result/schema/timeframe foundation and CLI.
2. OHLC + source + cron doctor.
3. News + learning + synchronization doctor.
4. CI integration and cross-language fixtures.
5. Walk-forward research laboratory.
6. C++ benchmark prototype only after profiling identifies a bottleneck.
7. APK doctor integration and Intelligence-360 health surfacing.

## Acceptance

The extension is complete when a clean checkout can run the existing Node validation and `python tools/py/ifx.py doctor --deep --json`, both produce reproducible evidence, deliberate stale/duplicate/wrong-next-candle fixtures are detected, and optional C++ results (when enabled) are numerically equivalent to the reference fixtures before their performance is considered.
