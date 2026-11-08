# HELIX research-only integration v1
This module is intentionally **not wired** into the deployed Worker, scheduled workflows, Telegram sender, or Cloudflare bindings.
Input: independently sourced M1 OHLC records with UTC opening timestamps and receipt timestamps, a provider identifier, symbol, and explicit historical asOf.
Supported labels: XAUUSD, BTCUSD, OIL. Labels do not imply the same market instrument across providers; contract metadata and spot-vs-futures identity must be independently verified.
`normalize()` fails closed for invalid OHLC, duplicate bars, future receipt, receipt before close, forming bars, stale feeds and unsupported symbols. Missing M1 slots invalidate aggregate completeness.
`researchSnapshot()` produces deterministic preview-only summaries and never sends messages.
`db/helix-research.sql` is an unapplied proposed D1 schema. No database migrations or writes are performed.
Before any live integration: verify legal/provider access, source-to-symbol contract mapping, UTC calendar/session handling, callback authentication, rate limits, D1 transactions and crash/retry semantics, and run real-worker staging tests.
Deployment and Telegram delivery require separate explicit authorization.
