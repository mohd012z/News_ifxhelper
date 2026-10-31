# Price-track and ATR-target repair (31 October 2026)

## Incident
An alert for a September 30 news article was delivered on October 31 as
`FLAT / INCONCLUSIVE`, with `undefined%`, no exit price and a false
"~45 minutes later" claim. Its final checkpoint was actually MN1 (30 days).

## Root causes
- `telegram-notify.js` used the removed legacy fields
  `predictedPct`, `priceAtSettle` and top-level `realizedPct`, whereas
  `build-news.js` now records `impactScore` and timestamped checkpoints.
- `verdict` is not populated by the observation model. Missing verdict
  therefore fell through to the misleading FLAT result.
- `build-news.js` collected Yahoo `GC=F` **gold futures** as a gold tab
  proxy, despite describing it as XAU/USD spot.
- The news and speaker cards treated a **heuristic impact score** as a
  statistically calibrated percent return and used it to imply a target.
- The event card could use a stale ATR daily close as a live price target.

## Repair
1. Normalize legacy and new result formats with recomputed observed percentage
   and actual checkpoint capture time. Mark late observations and do not
   classify forecast success from missing data.
2. Record provider name, quote symbol and exchange timestamp. Reject quotes
   older than 15 minutes; absence is preferable to a stale weekend close.
3. Only generate illustrative ATR(14) scenario levels if the headline is dated
   within two hours, the quote and ATR refer to the *same provider symbol*,
   the quote age is <=15 minutes and ATR age <=48 hours.
4. Explicitly label `GC=F` as **gold futures**. Do not present it as a
   broker-specific XAU/USD spot TP. Spot TP requires spot OHLC/ATR and an
   executable bid/ask from the same market/broker.
5. Do not send Telegram alerts on import in test mode. CLI behavior stays
   behind `require.main === module`. Main and live state are untouched.

## Formula / scope
For a validated instrument-matched quote E and Wilder ATR(14) A:
- SELL: SL = E + 1.2A, TP1 = E - 1.5A, TP2 = E - 2.5A.
- BUY: SL = E - 1.2A, TP1 = E + 1.5A, TP2 = E + 2.5A.

These are *conditional geometry scenarios*, not statistical price predictions,
recommendations or automated orders. The underlying headline polarity remains
heuristic. No independent performance calibration has been demonstrated.

## Verification
Run `npm run test:market-review`, `npm run test:market-card` and `npm test`
under Node.js 20+. No token, paid market API, broker credentials or live
Telegram chat is required. Feed/network tests require network access.

## Known limitations and follow-up
- Yahoo `GC=F` and spot XAU/USD have a basis; do not silently mix them.
- A scheduled collector does not capture a one-minute price sample just because
  its checkpoint is named M1. `timing` marks late data; improve the backend
  with actual timestamp-aligned historical bars for quantitative validation.
- The heuristic classifier score must undergo out-of-sample calibration before
  any model-expected-return claim is made.
- For real spot XAU/USD TP levels, ingest broker-matched bid/ask, trading status,
  instrument digits and M15/H1 ATR, and add spread/slippage/risk checks.
- Historical messages already delivered cannot be edited by this PR; keys
  remain marked sent, avoiding retroactive duplicate notifications.
