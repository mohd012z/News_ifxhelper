# XAU//DESK - Gold · Forex · Crypto News Desk

A local, self-contained market dashboard that turns daily news and central-bank speeches into
**trade direction (BUY/SELL)** and an **estimated % price impact**, per instrument, per timeframe.

Open **`index.html`** in any browser. No server, no build step, no internet required.

---

## 1. Files

| File | Role |
|---|---|
| `index.html` | News/speaker desk - page structure + CSS. |
| `app.js` | News/speaker desk logic (tabs, tables, charts, calculators, analysis). |
| `trade-plan.html` | **Trade Plan desk** - order summary page. |
| `trade-plan.js` | Trade Plan logic (entry/SL/TP generation). |
| `live.js` | The live feed: HTTP polling + optional WebSocket, with latency/quality tracking. |
| `atr.js` | Measured ATR(14) per instrument. Generated, do not hand-edit. |
| `build-atr.js` | Node script that regenerates `atr.js` from real OHLC. |
| `xauusd-data.js` | **The data.** Rewritten every day by the cron job. |

> Keep all of them in the same folder. If a data file is missing you will see a red banner.

**Two pages:** `index.html` = news + speakers + alerts. `trade-plan.html` = the order summary.

---

## 2. Instruments (tabs, left rail)

| Tab | What it shows |
|---|---|
| **GOLD · XAU/USD** | Spot gold, DXY, US 10Y, Brent, hike odds |
| **CRYPTO** | BTC / ETH majors |
| **FOREX** | EUR/USD headline with DXY, USD/JPY, GBP/USD |

Every tab carries the **same 12 panels**, so the method is identical across assets:
hero KPIs, hawkish/dovish gauge, today+weekly alerts, incoming events, news feed,
speaker watch, cross-asset map, impact model, range calculator, charts, levels, calendar, macro pressure.

---

## 3. The direction rule

```
hawkish speech  -> SELL the risk asset   /  BUY the USD
dovish speech   -> BUY  the risk asset   /  SELL the USD
```

Per instrument (shown under the gauge):

- **Gold** - hawkish = SELL gold, dovish = BUY gold
- **Crypto** - hawkish = SELL crypto, dovish = BUY crypto
- **Forex** - hawkish Fed = BUY USD (SELL EUR/USD, BUY USD/JPY); dovish = the inverse

---

## 4. How the estimated % impact is calculated

```
impact% = BASE × speakerWeight × signalStrength × surpriseFactor
```

| Factor | Values |
|---|---|
| **BASE** | max assumed single-event move: 2.5% (gold / forex), 3.25% (crypto, more rate-sensitive) |
| **Speaker weight** | Fed Chair 1.0 · central-bank decision/head 0.9 · FOMC voter 0.8 · analyst/CIO 0.35 · politician 0.15 |
| **Signal strength** | actual policy decision 1.0 · explicit forward guidance 0.7 · vote/dissent 0.6 · commentary 0.4 · political pressure 0.25 |
| **Surprise factor** | unpriced 1.0 · partly priced 0.5 · largely priced 0.35 · fully priced 0.15 |

Each speaker card prints its own inputs (`w x s x f`) so you can audit the arithmetic.

**This is a heuristic, not measured data.** Events overlap (a Fed hike and a Warsh speech are not
independent), so the "cumulative" figure is a *directional gauge*, not an additive forecast.

---

## 5. How the range that news can move is calculated (Range Calc tab)

Four standard methods, all editable in the built-in calculator:

| # | Method | Formula |
|---|---|---|
| 1 | Realized range | `range% = (High - Low) / Open × 100` |
| 2 | ATR expected range | `TR = max(H-L, \|H-PrevClose\|, \|L-PrevClose\|)`, `ATR = 14-period mean`, `expected = ATR × k` |
| 3 | Options-implied move | `expected move = Price × IV × √(DTE / 365)` |
| 4 | Event study | `AR = R_asset - E(R_asset)`, `CAR = Σ AR over [t-1, t+1]` |

Rule of thumb for **k**: 1.0 for a normal session, **1.5-2.0 for CPI / FOMC / NFP**.
Wilder smoothing for ATR: `ATR_t = ((ATR_(t-1) × 13) + TR_t) / 14`.

Enter your own Open/High/Low/PrevClose/ATR/IV/DTE and it computes all four live.
Defaults are **illustrative** - replace them with your broker's numbers.

---

## 6. Timeframes

News is tagged:

- **Intraday** - today only
- **1-3D** - a few sessions
- **Weekly** - this week
- **Structural** - months and beyond

Use the timeframe chips above the news table to filter.
The **News Incoming** panel gives each upcoming event a **focus timeframe** (e.g. M5-M15 for the
FOMC spike, M15-H1 for the press conference) plus a one-line play note.

---

## 7. Daily refresh

A cron job refreshes `xauusd-data.js` every morning (08:00 Asia/Singapore) using live search.
It only rewrites the data file - `index.html` and `app.js` are untouched.
You can also click **Refresh** in the top bar to reload the page after the file changes.

---

## 8. Customising

| You want to change | Edit |
|---|---|
| Colours / fonts | the `:root` and `html[data-theme="light"]` blocks in `index.html` |
| Add an instrument | add one object to `tabs[]` in `xauusd-data.js` (copy an existing tab's shape) |
| Add / remove an FX pair | `fxPairs[]` - `base` and `quote` must exist in `currencies[]` |
| Change a currency's bias or stance | `currencies[]` - the pair signals recompute automatically |
| Change SL/TP geometry | `plan.slAtr`, `plan.tp1Atr`, `plan.tp2Atr`, `plan.entryOffsetAtr` |
| Change crypto/commodity bias | `macroBias` |
| Add an instrument to the plan | add it to `INSTRUMENTS` in `build-atr.js`, re-run the script |
| Session windows / best hours | `sessions[]`, `bestWindow` |
| Poll interval | `live.intervalSec` |
| Live endpoints | `live.fxEndpoint`, `live.cryptoEndpoint` |
| BASE or weight tables | `model.base`, `model.weights/strength/surprise` |
| Upcoming events | `incoming[]` |
| Cross-asset rules | `crossAsset.rows[]` |
| Range defaults | `ranges.prefill` |

---

## 9. Live prices (no demo mode)

There is no simulated mode. Prices are either **live-polled** or the **last stored snapshot**, and the
badge always says which.

- **FX**: one request to the Coinbase EUR rate table rebuilds every pair: `price(A/B) = rate(B) / rate(A)`.
- **Crypto**: the Coinbase BTC rate table gives BTC directly and ETH/SOL via `rate(USD) / rate(coin)`.
- Poll interval is 5s by default. The badge shows `LIVE + tick count + last poll time`.

### True tick streaming (optional)

Paste a WebSocket URL that emits JSON quotes into the Live Feed panel and press **Open stream**:

```json
{ "symbol": "BTCUSDT", "price": 78000 }
```

The parser also accepts `s`/`c` (Binance trade frames) and `data.price`. Use **Close stream** to stop.

### If it goes OFFLINE

A CORS block or no network shows `OFFLINE` with the reason, and the last snapshot stays on screen.
Nothing is faked to fill the gap.

---

## 12. Trade Plan desk (`trade-plan.html`)

One row per instrument (18 forex pairs, 3 crypto, 6 commodities) with:
**live price - signal - trend - entry (market + limit) - stop loss - TP1/TP2 - R:R - volatility - timeframe - next event in Malaysia time - score - fundamental support - ATR source.**

### How the levels are built

```
ATR(absolute) = live price x ATR% / 100
entry  = market price          (limit variant = price -/+ 0.25 ATR)
SL     = entry -/+ 1.2  x ATR
TP1    = entry +/- 1.5  x ATR      -> R:R 1:1.25
TP2    = entry +/- 2.5  x ATR      -> R:R 1:2.08
```

R:R is deliberately constant, so the sheet compares instruments by **volatility and bias**, not by structure.

### Where ATR comes from (real data)

`build-atr.js` fetches ~3 months of daily OHLC and computes Wilder ATR(14):
Yahoo Finance for FX and commodities (`EURUSD=X`, `GC=F`, `BZ=F`...), Coinbase Exchange candles for crypto.
Run it any time: `node build-atr.js`. The daily cron refreshes it too.

> Commodity rows are **futures** contracts (`GC=F` gold, `BZ=F` Brent); a basis versus spot exists.

---

## 13. Timezone

Everything user-facing is **Malaysia time (MYT, GMT+8)**: the sessions table, the News Incoming panel
and the Trade Plan's *Malaysia time (next event)* column (GMT is kept alongside for reference).

Session windows in MYT: Sydney 05:00-14:00, Tokyo 08:00-17:00, London 15:00-24:00, New York 20:00-05:00,
London/NY overlap 20:00-24:00.

---

## 14. Install as an app / build an APK

See **[ANDROID.md](ANDROID.md)** for the full walkthrough. Short version:

- **PWA (no APK):** `npm run serve`, or host the folder on any https host, then on Android Chrome use
  *Add to Home screen*. `manifest.webmanifest`, `sw.js`, `pwa.js` and `icons/` are already wired in.
- **Real APK:** `npm install` -> `npm run prepare-web` -> `npx cap add android` -> `npm run cap:sync` ->
  `npm run cap:open` (or `npm run apk:debug`). Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
- **Play Store wrapper:** Bubblewrap or pwabuilder.com against the hosted PWA.

---

## 15. Quality notes

- Desktop and mobile layouts (single-column fallback under 1150px).
- Light/dark theme, persisted to `localStorage` (best-effort; safely degrades).
- Chart hover crosshair + click-to-focus.
- Command palette: press `/` - try `gold`, `forex`, `crypto`, `filter incoming`, `live on`, `live off`.
- Keyboard: `Esc` closes overlays. All charts/tables are semantic HTML with `aria-label`s.
- Honest placeholders: unknown figures show `-`; no fabricated statistics.

---

## 16. Disclaimer

Educational/market-analysis tool only. **Not financial advice.** The % impacts and levels are
model estimates and analyst references, not predictions. Verify against your broker's live feed
before trading.
