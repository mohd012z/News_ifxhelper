# MTF Weekly Background Research Implementation Plan

> Execute with superpowers TDD/executing-plans. Keep the existing green Intelligence-360 behavior as the regression baseline.

**Goal:** Extend XAU intelligence from M5/M15/M30/H1/H4/D1 to W1/MN1, capture Thursday/Friday and week-of-month context, perform daily and pre-event research in the background, and feed immutable snapshots plus historical cohorts into Intelligence-360 without turning historical tendencies into deterministic trade instructions.

**Branch:** `feature/hybrid-doctor-cli`

## Architecture

`market data -> resampling -> BBMA MTF -> calendar context -> immutable capture -> historical index -> daily/event research -> background settlement -> Intelligence-360 -> health/dashboard`

Node remains production authority. JS Doctor provides fast operational checks. Python independently validates critical timing/history. Research snapshots are immutable and separate from outcomes.

## Task 1 — W1/MN1 timeframe support
- Add W1 and calendar-month MN1 aggregation without approximating a month as fixed minutes.
- Test week/month boundaries, UTC timestamps, incomplete current W1/MN1 candles, and previous closed candle selection.
- Preserve M5/M15/M30/H1/H4/D1 behavior.
- Green gate: resampler + BBMA tests.

## Task 2 — BBMA MTF roles
- Extend BBMA analysis to M5/M15/M30/H1/H4/D1/W1/MN1.
- Add explicit roles: MN1 macro, W1 weekly, D1 daily, H4 swing, H1 intraday, M30 reaction structure, M15 setup, M5 confirmation.
- Output Upper/Mid/Lower BB, EMA50 relation, width, width percentile, squeeze/expansion, Extreme, Momentum, Reentry, CSAK, ATR regime and candle location.
- Do not use timeframe majority voting; conflicts remain visible.

## Task 3 — Calendar/weekly context
- Add deterministic day-of-week and trading-week-of-month classification.
- Store Thursday/Friday flags plus Week1..Week5.
- Add weekly/monthly open/high/low, range consumed and ATR consumed metrics.
- Test months beginning midweek and holiday/missing-session data without inventing candles.

## Task 4 — Immutable snapshot capture
- Create MARKET, EVENT, CONTEXT and OUTCOME snapshot schemas.
- Capture sourceAt, capturedAt, snapshotId, dataVersion, source quality, MTF state, news state, cross-assets, raw prediction and conflicts.
- Never mutate a prediction snapshot after capture.
- Outcome records reference snapshotId instead of overwriting prediction state.

## Task 5 — Thursday/Friday learning chain
- Capture THU_OPEN, THU_CLOSE, FRI_OPEN, FRI_CLOSE/W1_CLOSE.
- Measure ThuOpen->ThuClose, ThuClose->FriOpen, FriOpen->FriClose and ThuOpen->W1Close independently.
- Index by week-of-month, W1/MN1 BBMA state, volatility/news regime and lower-timeframe context.
- Report observed counts/sample sizes, never hard-code “Friday reverses” or similar rules.

## Task 6 — Week-1/Week-3 historical cohorts
- Build Week1 and Week3 cohorts while retaining Week2/4/5 data for controls.
- Compare recent 30/90-day, 12-month and full-history cohorts separately.
- Add minimum sample and regime-similarity labels.
- Feature weight must fall when historical evidence does not show stable differentiation.

## Task 7 — Daily research dossier
- At new trading date, build event dossiers for relevant upcoming events.
- Preserve schedule, previous, forecast, actual when available, revisions, source provenance, historical surprise/reaction, speech/news context, DXY/yields and MTF BBMA state.
- Store research version/hash and change reasons.
- No change -> SKIPPED_UNCHANGED.

## Task 8 — Pre-event reanalysis
- Schedule refresh windows around important events: T-24h, T-6h, T-1h, T-30m, T-15m, T-5m and final pre-event capture.
- Recalculate only dependencies that changed.
- Freeze immutable PRE_EVENT snapshot before outcome data is incorporated.
- Missing data produces UNKNOWN rather than inferred values.

## Task 9 — Post-event reaction capture
- Capture exact M1/M5/M15/M30/H1/H4 checkpoints.
- Delayed cron must not substitute a later candle for a missing checkpoint.
- Preserve actual-vs-forecast, revision and observed cross-asset response separately from technical state.

## Task 10 — Fast historical index
- Build compact indexes for symbol, timeframe, dayOfWeek, weekOfMonth, newsMode, eventCategory, bbLocation, bbmaPattern, atrRegime, squeezeState, mtfState and crossAssetState.
- Historical matching first narrows through indexes, then performs exact comparison.
- Record input/content hashes to skip unchanged work.

## Task 11 — Background learner
- Live path: capture -> queue -> return quickly.
- Background path: find due observations -> exact settlement -> cohort update -> calibration -> drift detection -> summary.
- Track full-history and recent performance independently.
- Flag PERFORMANCE_DRIFT when recent calibrated behavior materially diverges; do not automatically reverse direction.

## Task 12 — Output separation
Create/maintain separate authoritative artifacts:
- `data/current-snapshot.json` — what is known now.
- `data/learning-summary.json` — settled historical evidence/calibration.
- `data/system-health.json` — freshness, source/cron/sync/conflict state.
- Existing Intelligence-360 references these artifacts with timestamps/IDs rather than copying ambiguous “latest” values.

## Task 13 — Cron ownership
- One writer per artifact.
- Market incremental job handles closed-candle updates and dependent BBMA buckets.
- Context job handles news/speech/cross-assets.
- Research job handles daily dossier/change detection.
- Event windows trigger pre/post-event reanalysis.
- End-of-day settles observations and updates daily summary.
- Weekly/monthly close updates W1/MN1 research.
- Use concurrency locks and content hashes to prevent commit collisions.

## Task 14 — JS Doctor fast checks
- Add checks for W1/MN1 closure, weekly classification, snapshot immutability, output ownership, stale research versions and event-window completion.
- Fast doctor should diagnose operational failures without recomputing the entire research history.

## Task 15 — Python independent verification
- Independently validate W1/month boundaries, Thursday/Friday snapshot chronology, Week1/Week3 classification, exact reaction checkpoints and no-future-leakage.
- Cross-language disagreement becomes diagnostic conflict evidence.

## Task 16 — Dashboard/APK integration
- Show M5..MN1 states with structural roles.
- Show Thursday/Friday + Week-of-Month context only as historical evidence.
- Keep model confidence, empirical accuracy and sample size separate.
- Show LIVE/DELAYED/STALE/CONFLICT/OFFLINE from authoritative source timestamps.
- Cached APK data retains original source timestamp.

## Task 17 — Final verification
- Run all existing Node tests first.
- Run new W1/MN1, calendar, snapshot, cohort, research and event-window tests.
- Run JS Doctor.
- Run Python doctor/cross-check when available.
- Deliberately test missing M30 reaction, stale daily research, duplicate snapshots, wrong Week3 classification, incomplete W1/MN1 and stale APK cache.
- Verify no research/doctor process rewrites immutable prediction snapshots.
- Only mark green from fresh CI/runtime evidence.

## Target summary output

```text
XAUUSD | Thursday | Week 3
MN1  UP / MID->TOP / EXPANDING
W1   UP / TOP_BB / EXTREME_HIGH
D1   UP
H4   REJECTION
H1   REENTRY_SELL
M30  DOWN
M15  DOWN
M5   CONFIRM
MTF  CONFLICT

Historical cohort: Thu + Week3 + W1 TopBB + MN1 Up
Comparable cases: <measured count>
Observed outcomes: <measured counts>
Model confidence: <model value>
Empirical accuracy: <measured value or insufficient samples>
Research version: <id>
Health: <verified freshness states>
```
