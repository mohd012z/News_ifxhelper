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

## Nine-timeframe extension (M1, M5, M15, M30, H1, H4, D1, W1, MN1)
This PR now includes \`lib/atr-mtf-engine.js\` and \`build-atr-mtf.js\`.
Four independently sourced Yahoo GC=F futures OHLC tiers feed exactly nine
Wilder ATR(14) frame calculations:

| Frame | Input OHLC | Calculation |
| --- | --- | --- |
| M1 | Yahoo 1m, 5d | 1-minute closed bars |
| M5 | Yahoo 5m, 1mo | 5-minute closed bars |
| M15 / M30 | Yahoo 5m, 1mo | Exact contiguous 5m resampling |
| H1 | Yahoo 1h, 3mo | 1-hour closed bars |
| H4 | Yahoo 1h, 3mo | Exact contiguous 1h resampling |
| D1 | Yahoo 1d, 5y | Completed daily bars |
| W1 | Yahoo 1d, 5y | Completed Monday–Monday UTC weekly buckets, trading days only |
| MN1 | Yahoo 1d, 5y | Completed UTC calendar months, trading days only |

**No forward fill:** partial/invalid/duplicate/insufficient/old candles
render individual timeframe rows as unavailable. ATR requires at least 15
completed candles in each frame. Per-timeframe SL/TP levels use ATR(14)
from that frame only, with source equality against the quote (symbol AND
provider). W1 / MN1 use true calendar boundaries, not 7- or 30-day
rolling durations. The futures default is labelled **GC=F**, not XAU/USD spot.

A genuine broker XAU/USD spot adapter may pass four granular OHLC sets to
\`analyzeAll(sets, {instrument:'XAU/USD',provider:'BROKER',
source:'broker:XAU/USD'})\` and an independently timestamped matching spot
quote to \`buildMultiTimeframeTargets\`. The repository does **not** contain
an authenticated real-time spot broker feed; it must not emit purported
live XAU/USD spot entry/TP prices until that is configured and validated.

Collector runs at the existing 30-minute News Watch and daily refresh
schedules, before notifications. It introduces no extra scheduled workflow
or paid AI provider. A market-closed weekend or Yahoo rate-limit may cause
individual/all unavailable statuses. Existing downstream consumers can
inspect \`window.ATR_MTF.timeframes\` in the web/APK bundle after the first
successful scheduled refresh.

Checks: \`npm run test:atr-mtf\`, \`npm run test:market-review\`,
\`npm run test:market-card\`, and \`npm test\`. The scope is read-only
market analysis, never automatic orders or a backtested guarantee.


## Read-only broker XAU/USD integration (OANDA v20, nine timeframes)

### Verified provider contracts
OANDA account pricing supplies account-specific bid/ask, quote time and
tradeable status. Its v20 candle API directly supports M1, M5, M15, M30,
H1, H4, D, W and M, and returns a \`complete\` flag and midpoint OHLC.
This project uses the **direct provider candle intervals** to respect its
session alignment (especially D/W/M), without pretending UTC-resampled
futures bars are broker XAU/USD spot candles.

Official references:
- https://developer.oanda.com/rest-live-v20/pricing-ep/
- https://developer.oanda.com/rest-live-v20/instrument-df/
- https://developer.oanda.com/rest-live-v20/development-guide/

The broker XAU_USD instrument is an **account-specific OTC quotation**.
It is not a global consolidated spot exchange price. Symbol access and
quote availability depend on the authorized broker account.

### Modules
- \`lib/oanda-spot-adapter.js\`: read-only v20 GET client and nine provider-
  native ATR14 validators, data-status/error normalization, bid/ask spread.
- \`build-oanda-spot.js\`: optional secure server-side collector. Produces
  \`spot-mtf.js\` for the browser/Capacitor bundle. No token or account ID is
  serialized. With no credentials it generates \`UNCONFIGURED\` and nine
  unavailable rows (never a synthetic spot quote).
- \`lib/market-signal-review.js\`: side-aware entry reference (BUY ask /
  SELL bid) plus age, source equality and spread-to-ATR safety gates.
- \`telegram-notify.js\`: gold uses broker XAU/USD quote and broker XAU/USD
  OHLC for all nine timeframe rows. It does **not** substitute GC=F.
- \`test/oanda-spot-adapter.test.js\` and
  \`test/telegram-market-card.test.js\`: mock all nine data granularities,
  missing instrument, market closed, stale quote, wide spread, mismatched
  sources, and credential-free fallback.

### Server-side configuration
Only authorized, already-available credentials can enable the optional
collector. Existing GitHub refresh workflows accept secret environment
variables \`OANDA_API_TOKEN\` and \`OANDA_ACCOUNT_ID\`, and explicitly set
\`OANDA_ENV=practice\`. Do not add credentials to repository files,
public JavaScript, HTML, issues, PRs, Telegram messages, or commits.
No token was supplied or inspected during this implementation.

The collector requests **GET pricing and GET candles only**. No order,
position, account-history or trade endpoints are implemented. The
existing schedules run the collector before news notifications; no paid
API, new recurring workflow or live order service is added.

### Validity gates
1. Pricing instrument must equal \`XAU_USD\`, have valid best bid <= ask,
   an allowed tradeable status, and a source timestamp no older than 5 min.
2. Candle response instrument and granularity must match the requested
   one. Only \`complete:true\` midpoint OHLC candles are accepted;
   >=15 valid nonduplicate bars are required for Wilder ATR14.
3. ATR is computed **independently** per timeframe, from its own midpoint
   candle history, not copied from a daily ATR. Incomplete or stale
   frames return a distinct \`UNAVAILABLE\` reason.
4. The quote and ATR must agree on \`XAU/USD\` **and** exact
   \`oanda:practice:XAU_USD\` source identity. Forex/futures or another
   broker's ATR may not be combined with it.
5. BUY uses the ask for an indicative entry reference; SELL uses the bid.
   When spread exceeds half the frame ATR, that frame's price levels
   are suppressed as \`SPREAD_TOO_WIDE_FOR_ATR\`. The levels remain
   illustrations, not executable orders or statistically validated targets.
6. If credentials, instrument permission, provider response, quote
   freshness or market status is missing, show **no spot TP**.

### Honest operational status
The code and mocked provider contracts can be tested without real
broker access. Real OANDA pricing, geographic/product eligibility and
all nine real market-data response streams remain **unverified** until
an authorized existing broker connection is available and the market
is trading. Historical \`GC=F\` futures price-track records remain
labelled separately: their stored prices must never be merged with
broker XAU/USD spot quotes.

Run \`npm run test:spot-broker\` and \`npm test\`. The PR stays draft
until real-data validation; production / live trading is out of scope.
