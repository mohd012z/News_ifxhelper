# News_ifxhelper V2 architecture

## Goal
Separate collection, evidence, technical context, synchronization and presentation so a successful cron run cannot be mistaken for a correct market interpretation.

## Pipeline
Sources -> collectors -> source verifier -> normalizer -> evidence store -> event/speech/news engines -> macro + technical context -> conflict engine -> confidence/evidence state -> UI/Telegram -> reaction tracker.

## Evidence classes
OFFICIAL_RELEASE, OFFICIAL_SPEECH, OFFICIAL_CALENDAR, NEWS_REPORT, MARKET_ANALYSIS, SPECULATION, UNKNOWN.

Speculation is context only. It must never override an official release or verified observed price data.

## Event lifecycle
PRE_EVENT -> RELEASE_PENDING -> RELEASED -> CONFIRMING -> COMPLETE.

PRE_EVENT stores forecast, previous, history, related speeches and scenarios. RELEASED requires actual/forecast/previous where available. CONFIRMING compares observed market and technical reaction. Missing actual stays RELEASE_PENDING/WAIT rather than fabricating direction.

## Technical alignment
Use real OHLC per symbol/timeframe (M5/M15/H1/H4/D1). Technical context should expose trend, structure, ATR, support/resistance, breakout/retest and volatility. Fundamental evidence and technical evidence remain separate until ConflictEngine combines them.

## Conflict states
ALIGNED, MIXED, CONFLICT, INSUFFICIENT_DATA, STALE_DATA. A directional headline contradicted by observed price/technical state becomes CONFLICT rather than a stronger directional call.

## Fallback/sync
Remote current -> validated local cache -> bundled APK snapshot. The APK is never considered current merely because it built successfully.

data-manifest.json is the version/freshness contract. Clients compare generatedAt + SHA-256, fetch only changed datasets, validate them, then atomically promote them to cache. UI must show bundled/remote/cache timestamps and stale status.

## Collection cadence
General RSS/news: 30 min.
Calendar/event readiness: 5 min near scheduled high-impact events.
Macro snapshot: 30 min.
ATR: daily.
Price reaction: M1/M5/M15/M30/H1/H4/D1 where a reliable price source is available.

GitHub Actions is suitable for background collection but not guaranteed real-time delivery. Event-time collection should later move to a continuously running worker/service if sub-minute timing is required.

## Storage
Current phase: bounded JSON/JS + monthly JSONL history.
Future: storage adapter permits PostgreSQL/Supabase without rewriting analysis/UI.

## Reliability
Every dataset carries source, sourceClass, fetchedAt, publishedAt, observedAt, schemaVersion and confidence/evidence metadata. Source failure must preserve last-known-good data and mark it stale; it must not silently replace it with empty data.
