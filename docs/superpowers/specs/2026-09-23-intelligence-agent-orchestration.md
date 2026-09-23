# Intelligence Agent Orchestration Specification

## Goal
Build a coordinated intelligence layer for News_ifxhelper that continuously collects, validates, cross-checks, learns from, and publishes market/news/BBMA evidence without presenting stale or conflicting data as fresh certainty.

## Scope
The system coordinates market OHLC, BBMA/ATR/squeeze, ForexFactory economic events, news/speech context, cross-asset evidence, one-step-ahead research observations, fallback/callback behavior, learning, and dashboard/APK synchronization.

## Core Principles
1. Evidence before confidence: heuristic confidence is separate from empirical accuracy.
2. No silent stale fallback: stale, missing, conflicting, forming, and degraded data remain explicitly labeled.
3. Deterministic observations: each candle/event observation has a stable ID so overlapping cron jobs cannot double-learn.
4. Closed-candle learning: predictions are created from a closed source candle and settled only against the correct next closed candle.
5. Source provenance: every evidence item records sourceAt, fetchedAt, latency, provider, quality, and fallback state.
6. Fail closed: unresolved provider/source conflict becomes UNKNOWN/CONFLICT, not a forced directional result.
7. Research output only: one-step-ahead is a measured research state, not a guaranteed market prediction.

## Standard Evidence Envelope
Every agent emits a normalized object containing: id, agent, generatedAt, source, sourceAt, fetchedAt, latencyMs, quality, freshness, evidence, conflicts, fallbackUsed, callbackRequired, heuristicConfidence, empiricalAccuracy, sampleSize, and status.

## Agents
### Market Data Agent
Collect primary OHLC, invoke fallback on failure/staleness, validate OHLC invariants, detect duplicates/gaps/forming candles, resample deterministic M5/M15/M30/H1/H4/D1 frames, and publish provider health.

### BBMA Agent
Calculate BB(20,2), LWMA5/10 High/Low, EMA50, ATR, BB width/squeeze, candle anatomy, Top/Low/Mid BB and EMA50 location, Extreme/MHV/CSAK/Reentry/Momentum, and multi-timeframe alignment. M30 remains the H1-to-M15 bridge timeframe.

### Economic/News Agent
Collect economic calendar data, identify PRE_NEWS/NEWS_RELEASE/POST_NEWS/NORMAL modes, distinguish Forecast-vs-Previous expectation from Actual-vs-Forecast surprise, retain revisions, and attach related news/speech evidence.

### Research Agent
Cross-check economic, speech, historical reaction, BBMA, ATR, volatility, and cross-asset evidence. It may request fallback research or callback/retry when evidence is missing or contradictory. It must preserve uncertainty.

### Learning Agent
Create deterministic pending one-step observations, settle them on the correct next closed candle, prevent duplicate settlement, calculate performance by timeframe/news mode/location/squeeze/pattern, calibrate confidence buckets, and suppress empirical probability when comparable sample count is below 20.

### Orchestrator
Run agents in dependency order, merge normalized evidence, resolve source priority, expose conflicts, enforce freshness gates, and publish one coherent snapshot for the UI/APK.

## Scheduling
### 15-minute Market/BBMA Watch
Weekdays. Validate market data, build timeframes, calculate BBMA/ATR/squeeze, settle due predictions, create new eligible pending observations, and publish market snapshot.

### Event-aware Economic Watch
Regular calendar refresh plus PRE_NEWS/NEWS_RELEASE/POST_NEWS classification. Around relevant events, refresh evidence on the existing supported schedule rather than creating sub-hour schedules beyond platform limits.

### Hourly 360 Research
Reconcile market, economic/news/speech, cross-asset, provider-health, fallback, conflict, and historical-reaction evidence.

### Daily Learning/Health
Rebuild calibration/performance summaries, identify unresolved pending observations, source failures, stale data, duplicate IDs, missing checkpoints, and confidence-vs-accuracy drift.

### Weekly/Monthly Aggregation
Generate stable historical summaries by event category, timeframe, BBMA state, news mode, BB location, squeeze regime, and observed post-event reaction.

## Fallback and Callback State Machine
PRIMARY_OK -> CROSS_CHECK -> ACCEPTED.
PRIMARY_FAILED/STALE -> FALLBACK -> CROSS_CHECK.
If aligned -> DEGRADED_ACCEPTED with fallbackUsed=true.
If conflict -> CALLBACK_REQUIRED -> retry/research cross-check.
If unresolved -> CONFLICT/UNKNOWN. Never fabricate directional certainty.

## One-Step-Ahead Contract
Input must be a closed candle with acceptable quality. Raw state may be UP_BIAS, DOWN_BIAS, MIXED, or RANGE_OR_BREAKOUT_WATCH. Store the observation before the next candle outcome exists. Settle against the exact next timeframe candle. Display heuristic confidence separately from empirical comparable-case accuracy. Empirical accuracy is publishable only at sampleSize >= 20.

## Persistence
Publish compact JSON snapshots for UI consumption and append durable learning observations. Required logical outputs: bbma-watch, agent-health, intelligence-360, bbma-learning history, bbma-performance, and aggregation summaries. Writes must be deterministic and concurrency-safe.

## Dashboard/APK Contract
Show data freshness, last successful sync, provider/fallback state, unresolved conflicts, BBMA MTF matrix, M30 bridge, news mode, next/active event, expectation/surprise, cross-asset state, raw one-step state, comparable sample count, empirical accuracy, and calibration warning. Cached APK data must display its source timestamp and STALE/OFFLINE state when remote refresh fails.

## Failure Cases Requiring Tests
Provider outage; fallback outage; provider price conflict; ForexFactory/calendar outage; missing/duplicate M1 candles; forming candle; delayed cron; duplicate cron execution; concurrent writes; malformed source payload; news-release volatility; insufficient learning samples; stale APK cache; observation settled against wrong candle; revision of economic previous value; missing speech/news evidence.

## Success Criteria
No scheduled publisher commits a malformed snapshot. No stale/conflicting source is silently labeled fresh. No prediction learns from data that was unavailable at prediction time. Duplicate cron runs do not duplicate observations. Performance statistics are reproducible from persisted observations. Dashboard and APK can explain source, timestamp, quality, fallback/conflict state, and empirical sample support for every displayed one-step result.
