/* LiveFeed - real network polling for the XAU//DESK dashboards.
 *
 * What is live (all key-free, all CORS-enabled = Access-Control-Allow-Origin: *):
 *   - FX pairs   : Coinbase EUR rate table, every pair derived from it
 *   - Crypto     : Coinbase BTC rate table (BTC/ETH/SOL...)
 *   - Gold/Silver: gold-api.com XAU / XAG
 * Polling, not tick-by-tick. subscribe(url) accepts a WebSocket for true ticks.
 * Tracks latency, success rate and per-symbol tick history (for sparklines).
 *
 * ---- Fallback chain (auto-failover, no config needed) ----
 * Every free API can rate-limit, get geo-blocked, or shut down without notice. Each category
 * below tries its primary URL first; after FAIL_THRESHOLD consecutive misses on a category it
 * switches to that category's fallback for subsequent polls, and silently retries the primary
 * every RECOVERY_EVERY polls so it self-heals if the primary comes back. onStatus.source
 * reports which one is currently live, per category, so the UI can show it.
 *   FX     primary Coinbase exchange-rates (EUR table) -> fallback Frankfurter.app (ECB rates, ~daily)
 *   Crypto primary Coinbase exchange-rates (BTC table)  -> fallback CoinGecko /simple/price
 *   Gold   primary gold-api.com                          -> fallback CoinGecko tether-gold (XAUt, tracks spot)
 */
window.LiveFeed = (function () {
  "use strict";
  var timer = null, ws = null, running = false, inflight = false;
  var ticks = 0, okCount = 0, failCount = 0, backoffStep = 0;
  var lastFx = null, lastCrypto = null, lastMetals = {};
  var hist = {}, HIST_MAX = 24;
  var cfg = {}, onTick = null, onStatus = null, lastErr = "";
  var endpoints = [];

  var FAIL_THRESHOLD = 3, RECOVERY_EVERY = 12;
  var chain = {
    fx: { fails: 0, useFallback: false, pollsSinceSwitch: 0, source: "coinbase" },
    crypto: { fails: 0, useFallback: false, pollsSinceSwitch: 0, source: "coinbase" },
    metal: { fails: 0, useFallback: false, pollsSinceSwitch: 0, source: "gold-api.com" }
  };
  var FALLBACK = {
    fx: "https://api.frankfurter.app/latest?from=EUR",
    crypto: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,cardano,dogecoin&vs_currencies=usd",
    metal: "https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd"
  };
  var COINGECKO_ID = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", ripple: "XRP", cardano: "ADA", dogecoin: "DOGE" };
  function chainNote(cat, ok) {
    var c = chain[cat];
    if (ok) { c.fails = 0; return; }
    c.fails++;
    if (!c.useFallback && c.fails >= FAIL_THRESHOLD) { c.useFallback = true; c.pollsSinceSwitch = 0; c.source = cat + " fallback"; }
  }
  function chainTickRecovery(cat) {
    var c = chain[cat];
    if (!c.useFallback) return;
    c.pollsSinceSwitch++;
    if (c.pollsSinceSwitch >= RECOVERY_EVERY) { c.useFallback = false; c.fails = 0; c.pollsSinceSwitch = 0; c.source = cat === "fx" ? "coinbase" : cat === "crypto" ? "coinbase" : "gold-api.com"; }
  }

  function avgLatency() { if (!endpoints.length) return null; var v = endpoints.map(function (e) { return e.ms; }).filter(function (x) { return x != null; }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null; }
  function successRate() { var n = okCount + failCount; return n ? okCount / n : 0; }
  function quality() {
    var a = avgLatency(), r = successRate(), n = okCount + failCount;
    if (!n) return { label: "waiting", cls: "muted", latency: null, rate: 0 };
    if (r >= 0.98 && a != null && a < 600) return { label: "excellent", cls: "good", latency: a, rate: r };
    if (r >= 0.9 && a != null && a < 1500) return { label: "good", cls: "good", latency: a, rate: r };
    if (r >= 0.6) return { label: "degraded", cls: "acc", latency: a, rate: r };
    return { label: "poor", cls: "bad", latency: a, rate: r };
  }
  function sourcesSnapshot() {
    return {
      fx: chain.fx.useFallback ? "Frankfurter.app (fallback, ECB rates)" : "Coinbase exchange-rates (primary)",
      crypto: chain.crypto.useFallback ? "CoinGecko (fallback)" : "Coinbase exchange-rates (primary)",
      metal: chain.metal.useFallback ? "CoinGecko tether-gold (fallback)" : "gold-api.com (primary)"
    };
  }
  function status(state, message) {
    if (onStatus) onStatus({ state: state, message: message || "", ticks: ticks, at: new Date(), error: lastErr, quality: quality(), latency: avgLatency(), rate: successRate(), endpoints: endpoints.slice(), sources: sourcesSnapshot() });
  }
  function jget(url) {
    var t0 = Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json().then(function (j) { return { j: j, ms: Date.now() - t0 }; });
    }).catch(function (e) {
      var err = new Error(e.message);
      err.ms = Date.now() - t0;
      err.url = url;
      throw err;
    });
  }
  function push(key, v) {
    if (v == null || !isFinite(v)) return;
    if (!hist[key]) hist[key] = [];
    hist[key].push(v);
    if (hist[key].length > HIST_MAX) hist[key].shift();
  }

  function priceFromRates(rates, base, quote) {
    if (!rates || !rates[base] || !rates[quote]) return null;
    var b = parseFloat(rates[base]), q = parseFloat(rates[quote]);
    if (!b || !q) return null;
    return q / b;
  }

  function poll() {
    if (inflight) return;
    inflight = true;
    var jobs = [], gotAny = false;

    endpoints = [];
    function track(url) { var e = { url: url, status: "pending", ms: null, error: "" }; endpoints.push(e); return e; }

    if (cfg.fxEndpoint) {
      var fxUrl = chain.fx.useFallback ? FALLBACK.fx : cfg.fxEndpoint;
      var e1 = track(fxUrl);
      jobs.push(jget(fxUrl).then(function (r) {
        var rates = null;
        if (r.j && r.j.data && r.j.data.rates) rates = r.j.data.rates; // Coinbase shape
        else if (r.j && r.j.rates) { rates = r.j.rates; if (rates.EUR == null) rates.EUR = 1; } // Frankfurter shape (base=EUR, no self key)
        lastFx = rates;
        e1.status = lastFx ? 200 : 0; e1.ms = r.ms; if (lastFx) gotAny = true;
        chainNote("fx", !!lastFx);
      }).catch(function (e) { e1.status = "ERR"; e1.ms = e.ms; e1.error = e.message; lastErr = "FX: " + e.message; chainNote("fx", false); }));
    }
    if (cfg.cryptoEndpoint) {
      var cxUrl = chain.crypto.useFallback ? FALLBACK.crypto : cfg.cryptoEndpoint;
      var e2 = track(cxUrl);
      jobs.push(jget(cxUrl).then(function (r) {
        var j = r.j, out = {};
        if (Array.isArray(j)) {
          j.forEach(function (row) { var s = row.symbol || row.s, p = row.price || row.c; if (s && p) out[String(s).replace("USDT", "")] = parseFloat(p); });
        } else if (j && j.data && j.data.rates && j.data.currency) {
          var R = j.data.rates, base = j.data.currency, usd = parseFloat(R.USD);
          if (usd) { out[base] = usd; ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"].forEach(function (k) { if (k !== base && R[k]) { var v = parseFloat(R[k]); if (v) out[k] = usd / v; } }); }
        } else if (j && j.data && typeof j.data === "object") {
          Object.keys(j.data).forEach(function (k) { var v = parseFloat(j.data[k]); if (v) out[k] = v; });
        } else if (j && typeof j === "object") {
          /* CoinGecko /simple/price shape: { bitcoin: { usd: 12345 }, ethereum: { usd: 2500 }, ... } */
          Object.keys(COINGECKO_ID).forEach(function (id) { if (j[id] && j[id].usd) out[COINGECKO_ID[id]] = j[id].usd; });
        }
        var okC = Object.keys(out).length > 0;
        if (okC) { lastCrypto = out; gotAny = true; }
        e2.status = okC ? 200 : 0; e2.ms = r.ms;
        chainNote("crypto", okC);
      }).catch(function (e) { e2.status = "ERR"; e2.ms = e.ms; e2.error = e.message; lastErr = "Crypto: " + e.message; chainNote("crypto", false); }));
    }
    if (chain.metal.useFallback) {
      var emf = track(FALLBACK.metal);
      jobs.push(jget(FALLBACK.metal).then(function (r) {
        var px = r.j && r.j["tether-gold"] && parseFloat(r.j["tether-gold"].usd);
        if (px) { lastMetals.XAU = px; gotAny = true; }
        emf.status = px ? 200 : 0; emf.ms = r.ms;
        chainNote("metal", !!px);
      }).catch(function (e) { emf.status = "ERR"; emf.ms = e.ms; emf.error = e.message; lastErr = "Metals: " + e.message; chainNote("metal", false); }));
    } else {
      (cfg.metals || []).forEach(function (url) {
        var em = track(url);
        jobs.push(jget(url).then(function (r) {
          var sym = (r.j && r.j.symbol) || url.split("/").pop();
          var px = r.j && parseFloat(r.j.price);
          if (px) { lastMetals[sym] = px; gotAny = true; }
          em.status = px ? 200 : 0; em.ms = r.ms;
          chainNote("metal", !!px);
        }).catch(function (e) { em.status = "ERR"; em.ms = e.ms; em.error = e.message; lastErr = "Metals: " + e.message; chainNote("metal", false); }));
      });
    }

    if (!jobs.length) { inflight = false; status("offline", "no endpoints configured"); return; }

    Promise.all(jobs).then(function () {
      ticks++;
      chainTickRecovery("fx"); chainTickRecovery("crypto"); chainTickRecovery("metal");
      if (gotAny) { okCount++; backoffStep = 0; lastErr = ""; status("live", "polling"); }
      else { failCount++; backoffStep++; status("offline", lastErr || "no data"); }

      // record history after a successful poll
      if (lastFx) {
        Object.keys(hist).forEach(function (k) { if (k.indexOf("/") > -1) return; });
        (cfg.pairs || []).forEach(function (pair) {
          var p = pair.split("/"); var v = priceFromRates(lastFx, p[0], p[1]);
          if (v) push(pair, v);
        });
      }
      if (lastCrypto) Object.keys(lastCrypto).forEach(function (c) { push(c, lastCrypto[c]); });
      Object.keys(lastMetals).forEach(function (m) { push(m, lastMetals[m]); });

      if (onTick) onTick({ rates: lastFx, crypto: lastCrypto, metals: lastMetals, tick: ticks, at: new Date(), quality: quality(), endpoints: endpoints.slice(), sources: sourcesSnapshot() });
    }).then(function () { inflight = false; schedule(); });
  }

  function schedule() {
    if (!running) return;
    var baseMs = Math.max(2, Number(cfg.intervalSec) || 3) * 1000;
    var ms = baseMs * Math.pow(1.6, backoffStep);
    if (backoffStep > 0 && ms > 30000) ms = 30000;
    timer = setTimeout(poll, ms);
  }

  function start(config, tickCb, statusCb) {
    stop();
    cfg = config || {};
    onTick = tickCb; onStatus = statusCb; running = true; backoffStep = 0;
    status("connecting", "first request");
    poll();
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } running = false; }
  function isRunning() { return running; }

  function subscribe(url, cb) {
    try {
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      ws = new WebSocket(url);
      ws.onopen = function () { okCount++; status("streaming", "websocket open"); };
      ws.onmessage = function (ev) {
        try {
          var m = JSON.parse(ev.data);
          var price = m.price || m.p || m.c || (m.data && m.data.price);
          var sym = m.symbol || m.s || (m.data && m.data.symbol) || "STREAM";
          if (price) { ticks++; push(String(sym).toUpperCase(), parseFloat(price)); cb({ symbol: String(sym).toUpperCase(), price: parseFloat(price), raw: m }); }
        } catch (e) { /* non-JSON frame */ }
      };
      ws.onerror = function () { failCount++; lastErr = "WebSocket error"; status("offline", "websocket error"); };
      ws.onclose = function () { if (running) status("offline", "websocket closed"); };
      return true;
    } catch (e) { lastErr = e.message; status("offline", "websocket unsupported"); return false; }
  }
  function unsubscribe() { if (ws) { try { ws.close(); } catch (e) {} ws = null; } tdReconnect = false; status("live", "websocket closed"); }

  /* Twelve Data real-time WebSocket (true tick stream, e.g. XAU/USD).
   * Free tier: 1 concurrent real-time symbol. Auto-reconnects with backoff
   * while running; falls back silently to the existing poll loop if the
   * key/quota is unavailable (onStatus still reports "offline"). */
  var tdKey = null, tdSymbols = [], tdCb = null, tdReconnect = false, tdBackoff = 0, tdTimer = null;
  function tdConnect() {
    try {
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      ws = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(tdKey));
      ws.onopen = function () {
        okCount++; tdBackoff = 0;
        ws.send(JSON.stringify({ action: "subscribe", params: { symbols: tdSymbols.join(",") } }));
        status("streaming", "twelvedata ws open: " + tdSymbols.join(","));
      };
      ws.onmessage = function (ev) {
        try {
          var m = JSON.parse(ev.data);
          if (m.event === "price" && m.symbol && m.price != null) {
            var sym = String(m.symbol).toUpperCase();
            var price = parseFloat(m.price);
            if (!isFinite(price)) return;
            ticks++; push(sym, price); lastMetals[sym] = price;
            if (tdCb) tdCb({ symbol: sym, price: price, raw: m });
          } else if (m.event === "subscribe-status" && m.status === "error") {
            lastErr = "TwelveData: " + (m.fails && m.fails[0] && m.fails[0].reason || "subscribe error");
            status("offline", lastErr);
          }
        } catch (e) { /* non-JSON / heartbeat frame */ }
      };
      ws.onerror = function () { failCount++; lastErr = "TwelveData WS error"; status("offline", "twelvedata ws error"); };
      ws.onclose = function () {
        if (!tdReconnect) return;
        status("offline", "twelvedata ws closed, reconnecting…");
        tdBackoff++;
        var ms = Math.min(30000, 1000 * Math.pow(1.6, tdBackoff));
        tdTimer = setTimeout(tdConnect, ms);
      };
      return true;
    } catch (e) { lastErr = e.message; status("offline", "websocket unsupported"); return false; }
  }
  function streamTwelveData(apiKey, symbols, cb) {
    if (!apiKey || !symbols || !symbols.length) return false;
    if (tdTimer) { clearTimeout(tdTimer); tdTimer = null; }
    tdKey = apiKey; tdSymbols = symbols; tdCb = cb; tdReconnect = true; tdBackoff = 0;
    return tdConnect();
  }
  function stopTwelveData() { tdReconnect = false; if (tdTimer) { clearTimeout(tdTimer); tdTimer = null; } if (ws) { try { ws.close(); } catch (e) {} ws = null; } }

  return {
    start: start, stop: stop, subscribe: subscribe, unsubscribe: unsubscribe, isRunning: isRunning,
    streamTwelveData: streamTwelveData, stopTwelveData: stopTwelveData,
    priceFor: function (pair) { if (!pair || !lastFx) return null; var p = String(pair).split("/"); return p.length === 2 ? priceFromRates(lastFx, p[0], p[1]) : null; },
    metal: function (sym) { return lastMetals[sym] != null ? lastMetals[sym] : null; },
    history: function (key) { return hist[key] ? hist[key].slice() : []; },
    prices: function () { return { rates: lastFx, crypto: lastCrypto, metals: lastMetals }; },
    quality: quality,
    sources: sourcesSnapshot,
    endpoints: function () { return endpoints.slice(); },
    stats: function () { return { ticks: ticks, ok: okCount, fail: failCount, avgLatencyMs: avgLatency(), rate: successRate(), backoffStep: backoffStep, running: running }; }
  };
})();
