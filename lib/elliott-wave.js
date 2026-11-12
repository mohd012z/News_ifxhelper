/* lib/elliott-wave.js — Elliott Wave v2.9 engine (pure, UMD).
 * R1/R2/R3 rule gates + full fib matrix + channels + confluence + 2-scenario forecast
 * + E1 (2026-11-12) pro-channel upgrades: terminal extensions 1.0x/1.272x, compete()
 * "Red or Blue?", degree colors (MotiveWave ladder + EWSTRAT blue/red), revisionDiff
 * + E1.2 prediction primitives: structStop (wave-4-territory), pickTarget (confluence),
 * htfBias (higher-degree gate), tradeable (composite verdict).
 * No DOM. Browser: window.BBMA_EW. Node: require('./lib/elliott-wave.js').
 * Source of truth: /opt/data/cache/scratch/ewapp/engine.js — keep in lockstep.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BBMA_EW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
;
  const EXT = [1.618, 2.618, 4.236];
  const RET = [0.382, 0.5, 0.618, 0.786, 1.0];
  const pct = f => (f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 1).replace(/\.0$/, '') + '%';

  // count types: number of pivots (including origin) + labels per pivot index
  const TYPES = {
    impulse:   { points: 6, labels: ['0', '1', '2', '3', '4', '5'],            kind: 'motive' },
    sub:       { points: 6, labels: ['\u2022', '(i)', '(ii)', '(iii)', '(iv)', '(v)'], kind: 'motive' },
    diagonal:  { points: 6, labels: ['1', '2', '3', '4', '5', ''],             kind: 'motive' },
    zigzag:    { points: 4, labels: ['\u2022', 'A', 'B', 'C'],                 kind: 'corrective' },
    flat:      { points: 4, labels: ['\u2022', 'A', 'B', 'C'],                 kind: 'corrective' },
    wxy:       { points: 4, labels: ['\u2022', 'W', 'X', 'Y'],                 kind: 'corrective' },
    wxyxz:     { points: 6, labels: ['\u2022', 'W', 'X', 'Y', 'X', 'Z'],       kind: 'corrective' },
  };

  const signed = (a, b, dir) => (b - a) * dir; // positive = progress in wave direction

  function validate(count) {
    const p = count.pivots.map(q => q.price);
    const t = count.pivots.map(q => q.time);
    const n = p.length;
    const dir = count.dir || 1;
    const isMotive = (TYPES[count.type] || {}).kind === 'motive';
    const rules = [];
    const done = TYPES[count.type] ? n >= TYPES[count.type].points : false;

    if (isMotive) {
      const w1 = signed(p[0], p[1], dir);
      // R1: wave 2 must not retrace >100% of wave 1
      if (n >= 3) {
        const retr = n >= 2 && w1 !== 0 ? signed(p[1], p[2], -dir) / w1 : NaN;
        const pass = dir === 1 ? p[2] > p[0] : p[2] < p[0];
        rules.push({ id: 'R1', name: 'W2 limit', pass, detail:
          `W2 ${p[2].toFixed(1)} vs W1 origin ${p[0].toFixed(1)} — retrace ${(retr * 100).toFixed(1)}% (must be <100%)` });
      } else {
        rules.push({ id: 'R1', name: 'W2 limit', pass: null, detail: 'in progress — needs W2' });
      }
      // R2: W3 never the shortest of W1/W3/W5
      if (n >= 6) {
        const l1 = signed(p[0], p[1], dir), l3 = signed(p[2], p[3], dir), l5 = signed(p[4], p[5], dir);
        const pass = l3 >= Math.min(l1, l5) + 1e-9;
        rules.push({ id: 'R2', name: 'W3 not shortest', pass, detail:
          `W1 ${l1.toFixed(1)} · W3 ${l3.toFixed(1)} · W5 ${l5.toFixed(1)} — W3 must not be the shortest` });
      } else if (n >= 5) {
        rules.push({ id: 'R2', name: 'W3 not shortest', pass: null, detail: 'in progress — needs W5' });
      } else {
        rules.push({ id: 'R2', name: 'W3 not shortest', pass: null, detail: 'pending' });
      }
      // R3: W4 no overlap of W1 (diagonal exempt)
      if (n >= 5) {
        if (count.diagonal) {
          rules.push({ id: 'R3', name: 'W4 no overlap', pass: true, detail: 'DIAGONAL — overlap allowed (diagnostic of the pattern)' });
        } else {
          const pass = dir === 1 ? p[4] > p[1] : p[4] < p[1];
          rules.push({ id: 'R3', name: 'W4 no overlap', pass, detail:
            `W4 ${p[4].toFixed(1)} vs W1 ${p[1].toFixed(1)} — W4 must stay ${dir === 1 ? 'above' : 'below'} W1 (else diagonal)` });
        }
      } else {
        rules.push({ id: 'R3', name: 'W4 no overlap', pass: null, detail: 'in progress — needs W4' });
      }
    } else {
      // corrective: soft checks (B retrace of A, C/A ratio)
      if (n >= 2) {
        const a = Math.abs(p[1] - p[0]);
        if (n >= 3) {
          const b = Math.abs(p[2] - p[1]);
          rules.push({ id: 'B?', name: 'B retrace of A', pass: b / a <= 1.0 + 1e-9, detail:
            `B = ${pct(b / a)} of A (typical 38.2–61.8%, up to 100% in flats)` });
        }
        if (n >= 4) {
          const c = Math.abs(p[3] - p[2]);
          rules.push({ id: 'C?', name: 'C/A relation', pass: null, detail:
            `C/A = ${(c / a).toFixed(2)} (typical 1.0–1.618; C = 1.618\u00D7AB common)` });
        }
      }
    }
    const hard = rules.filter(r => ['R1', 'R2', 'R3'].includes(r.id) && r.pass === false);
    return {
      rules,
      valid: hard.length === 0 && done,
      inProgress: !done,
      violations: hard.length,
    };
  }

  // full fib target matrix for a count (as many as the pivots allow)
  function targets(count) {
    const p = count.pivots.map(q => q.price);
    const n = p.length;
    const dir = count.dir || 1;
    const out = [];
    const add = (label, price, note) => out.push({ label, price: +price.toFixed(2), note });
    const kind = (TYPES[count.type] || {}).kind;

    if (kind === 'motive' && n >= 2) {
      const w1 = signed(p[0], p[1], dir);
      for (const f of [0.5, 0.618, 0.786]) add(`W2 ${pct(f)}`, p[1] - dir * f * w1, 'retrace of W1');
      if (n >= 3) for (const e of EXT) add(`W3 \u00D7${e}`, p[2] + dir * e * w1, 'extension of W1 from W2');
      if (n >= 4) {
        const l3 = signed(p[2], p[3], dir);
        for (const f of [0.382, 0.5]) add(`W4 ${pct(f)}`, p[3] - dir * f * l3, 'retrace of W3');
      }
      if (n >= 5) {
        add('W5 = W1', p[4] + dir * w1, 'equality with W1');
        add('W5 = 1.618\u00D7W4', p[4] + dir * 1.618 * signed(p[3], p[4], -dir), 'extension of W4');
        add('W5 = 0.618\u00D7(1\u21923)', p[4] + dir * 0.618 * signed(p[0], p[3], dir), '0.618 of whole W1\u2013W3');
        // EWSTRAT terminal-low map: 1.0\u00D7 and 1.272\u00D7 extensions of W4 (same family as 1.618\u00D7W4).
        const w4len = signed(p[3], p[4], -dir);
        add('W5 = 1.0\u00D7W4', p[4] + dir * w4len, 'terminal 1.0\u00D7W4 (EWSTRAT low)');
        add('W5 = 1.272\u00D7W4', p[4] + dir * 1.272 * w4len, 'terminal 1.272\u00D7W4 (EWSTRAT low)');
      }
    } else if (kind === 'corrective' && n >= 2) {
      const a = signed(p[0], p[1], dir); // A length in direction of first leg
      if (n >= 3) {
        for (const f of [0.382, 0.5, 0.618, 0.786]) add(`B ${pct(f)}`, p[1] - dir * f * a, 'retrace of A');
      }
      if (n >= 3) {
        const ab = Math.abs(p[2] - p[1]);
        const alen = Math.abs(a);
        add('C = A', p[2] + dir * alen, 'equality (continues A)');
        add('C = 1.618\u00D7A', p[2] + dir * 1.618 * alen, 'extension of A');
        add('C = 1.618\u00D7AB', p[2] + dir * 1.618 * ab, "Marat's classic");
        add('C = 0.618\u00D7A', p[2] + dir * 0.618 * alen, 'shallow/complex');
      }
    }
    return out;
  }

  // base parallel channel (method 1) + 0-2 trendline (method 2).
  // times must be numeric (seconds) for extrapolation; returns segment endpoints.
  function channel(count, tEnd) {
    const p = count.pivots.map(q => q.price);
    const t = count.pivots.map(q => q.t || q.time);
    if (t.some(x => typeof x !== 'number') || p.length < 3 || t.length < 3) return null;
    const [t0, t1, t2] = t, [p0, p1, p2] = p;
    const slope = (p2 - p0) / (t2 - t0);
    const y = (x, baseT, baseP) => baseP + slope * (x - baseT);
    return {
      base:  [[t0, p0], [tEnd, y(tEnd, t0, p0)]],          // 0→2 trendline
      upper: [[t1, p1], [tEnd, y(tEnd, t1, p1)]],          // parallel clone through W1 peak
    };
  }

  // cluster target levels across counts: group levels within tolPct of each other
  function confluence(levels, tolPct = 0.5) {
    if (!levels.length) return [];
    const s = [...levels].sort((a, b) => a.price - b.price);
    const groups = [];
    let cur = [s[0]];
    for (let i = 1; i < s.length; i++) {
      const ref = s[i - 1].price;
      if (Math.abs(s[i].price - ref) / Math.max(1, Math.abs(ref)) * 100 <= tolPct) cur.push(s[i]);
      else { groups.push(cur); cur = [s[i]]; }
    }
    groups.push(cur);
    return groups.filter(g => new Set(g.map(x => x.countId)).size >= 2 || g.length >= 3)
      .map(g => ({
        price: +(g.reduce((a, b) => a + b.price, 0) / g.length).toFixed(2),
        lo: g[0].price, hi: g[g.length - 1].price,
        members: g,
      }));
  }

  const rr = (entry, stop, t) => {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(t - entry);
    return risk > 0 ? +(reward / risk).toFixed(2) : null;
  };

  // ---- FUTURE-MOVEMENT PREDICTION ----------------------------------------
  // Given the pivots of the CURRENT (in-progress) motive count, project the
  // remaining waves + corrective targets forward, return forecast points
  // (times extrapolated from the pivots' cadence) + the two scenarios.
  function forecast(count) {
    const p = count.pivots.map(q => q.price);
    const t = count.pivots.map(q => q.t);
    const n = p.length;
    const dir = count.dir || 1;
    const kind = (TYPES[count.type] || {}).kind;
    if (kind === 'corrective' || n < 2) return correctiveForecast(count);
    if (kind !== 'motive') return null;
    // cadence (bars/step) from consecutive pivots
    const steps = [];
    for (let i = 1; i < n; i++) { const d = t[i] - t[i - 1]; if (d > 0) steps.push(d); }
    const cad = steps.length ? Math.max(...steps) : 1;
    const tNext = (base, k) => base + k * cad;
    const out = { points: [], scenarios: [], confluence: [], count };
    const last = n - 1;
    const w1 = signed(p[0], p[1], dir);
    const w2low = n >= 3 ? p[2] : null;
    const w3 = n >= 4 ? p[3] : null;

    // which wave are we in?
    // n=2 -> in W1 or W2; n=3 -> in W2 done, W3 building; etc.
    const remaining = [];
    if (n < 3) {
      // W2 projection
      for (const f of [0.5, 0.618, 0.786]) remaining.push({ wave: 'W2', price: p[1] - dir * f * w1, note: `${f * 100}% of W1` });
    }
    if (n >= 3) {
      for (const e of [1.618, 2.618, 4.236]) remaining.push({ wave: 'W3', price: p[2] + dir * e * w1, note: `${e}×W1` });
    }
    if (n >= 4) {
      const l3 = signed(p[2], p[3], dir);
      for (const f of [0.382, 0.5]) remaining.push({ wave: 'W4', price: p[3] - dir * f * l3, note: `${f * 100}% of W3` });
    }
    if (n >= 5) {
      remaining.push({ wave: 'W5', price: p[4] + dir * w1, note: 'W5 = W1' });
      remaining.push({ wave: 'W5', price: p[4] + dir * 1.618 * signed(p[3], p[4], -dir), note: 'W5 = 1.618×W4' });
    }
    // corrective after W5 (ABC) — use W1-W5 net for A, and W4 length for C
    if (n >= 5) {
      const net15 = signed(p[0], p[4], dir);
      remaining.push({ wave: 'A', price: p[4] - dir * 0.382 * net15, note: 'A = 38.2% of (1-5)' });
      remaining.push({ wave: 'C', price: (p[4] - dir * 0.382 * net15) - dir * 0.618 * net15, note: 'C = 0.618×(1-5) from B' });
    }
    // assign extrapolated times
    let ti = t[last];
    let k = 1;
    for (const r of remaining) { r.t = tNext(t[last], k++); }
    out.remaining = remaining;
    // build forecast polyline: last real point -> remaining wave endpoints (primary path: W3 1.618, W4 50%, W5 W1)
    const path = [{ t: t[last], price: p[last] }];
    const pick = (w) => remaining.find(r => r.wave === w);
    if (n < 3 && pick('W2')) path.push({ t: pick('W2').t, price: pick('W2').price });
    if (n >= 3 && pick('W3')) path.push({ t: pick('W3').t, price: pick('W3').price });
    const w4p = (n >= 4) ? remaining.filter(r => r.wave === 'W4')[1] : null;
    if (w4p) path.push({ t: w4p.t, price: w4p.price });
    if (n >= 5) {
      const w5p = remaining.filter(r => r.wave === 'W5')[0];
      if (w5p) path.push({ t: w5p.t, price: w5p.price });
      const ap = pick('A'); if (ap) path.push({ t: ap.t, price: ap.price });
      const cp = remaining.filter(r => r.wave === 'C')[0]; if (cp) path.push({ t: cp.t, price: cp.price });
    }
    out.path = path;
    // scenarios
    const primaryTarget = (n < 5 && pick('W3')) ? pick('W3').price
      : (n >= 5 ? (remaining.filter(r => r.wave === 'W5')[0] || {}).price : null);
    const invalidation = n >= 3 ? p[0] : p[last] - dir * w1; // impulse origin (R1) / below W1
    out.scenarios.push({
      name: 'Primary',
      side: dir === 1 ? 'long' : 'short',
      entry: p[last],
      stop: invalidation,
      t1: primaryTarget,
      t2: (n >= 5 ? (remaining.filter(r => r.wave === 'C')[0] || {}).price : (n >= 4 ? (remaining.filter(r => r.wave === 'W3').pop() || {}).price : null)),
    });
    // alternative: the move is corrective / deeper retrace (R1 edge) -> opposite side toward invalidation-adjacent
    out.scenarios.push({
      name: 'Alternative (deeper)',
      side: dir === 1 ? 'short' : 'long',
      entry: p[last],
      stop: dir === 1 ? p[1] : p[0],
      t1: dir === 1 ? p[0] : p[0] + (p[1] - p[0]),
      t2: invalidation - dir * w1 * 0.236,
    });
    // confluence across remaining targets (2+ methods agreeing)
    out.confluence = confluence(remaining.map(r => ({ price: r.price, countId: r.wave + (r.note || ''), label: r.wave + ' ' + r.note })), 0.6);
    return out;
  }

  // Corrective (A-B-C / zigzag / flat) forecast: the remaining leg + retrace
  // targets projected forward. A-B-C with B = last pivot in progress:
  //  - C continuation (primary): C endpoint = A-low + |A-B| x {1.0, 1.618} of AB
  //  - B retrace floor: B holds at 38.2-50% of A->B, then C from there
  //  - invalidation: beyond the A pivot origin (R1 edge)
  function correctiveForecast(count) {
    const p = count.pivots.map(q => q.price);
    const t = count.pivots.map(q => q.t);
    const n = p.length;
    if (n < 3) return null;
    const steps = [];
    for (let i = 1; i < n; i++) { const d = t[i] - t[i - 1]; if (d > 0) steps.push(d); }
    const cad = steps.length ? Math.max(...steps) : 1;
    const a0 = p[0];            // A-origin
    const aTop = p[1];          // A extremum (the retrace pivot)
    const b = p[n - 1];         // B / current (in progress)
    const dir = count.dir || 1; // C-leg direction = the count's heading
    const aLeg = Math.abs(aTop - a0);   // A-wave length (A≈C projection base)
    const out = { points: [], scenarios: [], confluence: [], count, kind: 'corrective' };
    const remaining = [];
    // C leg: continues from B in the count direction; A≈C (1.0x) and 1.618x A
    for (const e of [1.0, 1.618]) remaining.push({ wave: 'C', price: b + dir * e * aLeg, note: `C = ${e}×A` });
    remaining.push({ wave: 'C', price: b + dir * aLeg * 0.618, note: 'C = 61.8% of A (near-term)' });
    let k = 1;
    for (const r of remaining) { r.t = t[n - 1] + k * cad; k++; }
    out.remaining = remaining;
    const path = [{ t: t[n - 1], price: b }];
    path.push({ t: remaining[0].t, price: remaining[0].price }); // C = 1x A
    path.push({ t: remaining[1].t, price: remaining[1].price }); // C = 1.618x A
    out.path = path;
    const c1 = remaining[0].price, c16 = remaining[1].price;
    out.scenarios.push({
      name: 'Primary',
      side: dir === 1 ? 'long' : 'short',
      entry: b, stop: aTop, t1: c1, t2: c16,
    });
    out.scenarios.push({
      name: 'Alternative (deeper)',
      side: dir === 1 ? 'long' : 'short',
      entry: b, stop: aTop + dir * aLeg * 0.236, t1: c16, t2: c16 + dir * aLeg * 0.236,
    });
    out.confluence = confluence(remaining.map(r => ({ price: r.price, countId: count.type + '-C', label: 'C ' + (r.note || '') })), 0.6);
    return out;
  }

  // ---- NEXT WAVE PREDICTION (fibo extensions) --------------------------------
  // Given the CURRENT count, project the NEXT wave's target set with fibonacci
  // extensions/retracements and a confluence pick:
  //   - in-progress motive (0..W4): next = W5; targets W5 = W1, 1.618×W4, 2.618×W4
  //     (terminal extensions), stop = below the W4 low (structure).
  //   - completed 5-wave: next = A-B-C correction; A = 38.2-50% of (1-5) retrace,
  //     B = 50% of A, C = 1.0×A / 1.618×A extension.
  //   - corrective (A-B-C in progress): next = C continuation; 1.0×A / 1.618×A.
  // Returns { wave, side, entry, stop, targets:[{wave,note,price}], predict:{price,note,confluence} }.
  function nextWave(count) {
    const p = count.pivots.map(q => q.price);
    const n = p.length;
    const dir = count.dir || 1;
    const kind = (TYPES[count.type] || {}).kind;
    const entry = p[n - 1];
    const targets = [];
    const extra = [];
    let wave = null, stop = null, retrace = false;
    const pt = count.pivots.map(q => q.t);
    const stepsN = [];
    for (let i = 1; i < n; i++) { const dd = pt[i] - pt[i - 1]; if (dd > 0) stepsN.push(dd); }
    const cadN = stepsN.length ? Math.max(...stepsN) : 1;
    if (kind === 'motive') {
      const w1 = signed(p[0], p[1], dir);          // W1 length
      if (n >= 5) {
        // Impulse complete -> next is the ABC correction off W5.
        wave = 'ABC';
        const net = signed(p[0], p[n - 1], dir);
        for (const f of [0.382, 0.5, 0.618]) targets.push({ wave: 'A', note: `A = ${pct(f)} of (1-5)`, price: p[n - 1] - dir * f * net });
        const aLen = net * 0.382;
        const b = p[n - 1] - dir * aLen * 0.5;
        for (const e of [1.0, 1.618]) targets.push({ wave: 'C', note: `C = ${e}\u00D7A from B`, price: b - dir * e * aLen });
        stop = p[n - 1] + dir * 0.236 * aLen; // beyond the B retrace = correction failed
      } else if (n === 4) {
        // 0-1-2-3 done, W4 complete -> next is W5 (terminal impulse leg).
        wave = 'W5';
        const w3 = signed(p[2], p[3], dir);
        const w4 = Math.abs(p[3] - p[2]);
        // Rule 2 (Wave-3): W5 must not be so long that W3 becomes the shortest of 1,3,5.
        const w5max = (w3 > w1) ? null : w3; // if W3 is longest, no cap; else W5 <= W3
        if (w1 > 0) targets.push({ wave: 'W5', note: 'W5 = W1 (terminal)', price: p[3] + dir * w1 });
        if (w3 > 0) targets.push({ wave: 'W5', note: 'W5 = 0.618\u00D7W3', price: p[3] + dir * 0.618 * w3 });
        if (w4 > 0) targets.push({ wave: 'W5', note: 'W5 = 1.618\u00D7W4', price: p[3] + dir * 1.618 * w4 });
        stop = p[3] - dir * w4; // beyond the W4 extreme = impulse broken
        if (w5max != null) extra.push({ wave: 'W5cap', note: 'Wave-3 rule cap W5\u2264W3', price: p[3] + dir * w5max });
      } else if (n === 3) {
        // 0-1-2 done. If p2 is the W2 retrace (not a new extreme) -> W3; else W1 done -> W2.
        const madeNew = dir === 1 ? p[2] >= p[1] : p[2] <= p[1];
        if (madeNew) {
          wave = 'W2';
          for (const f of [0.618, 0.786, 0.5]) targets.push({ wave: 'W2', note: `W2 = ${pct(f)} of W1`, price: p[1] - dir * f * w1 });
          stop = p[0]; // Rule 1: W2 must not retrace into W1 origin
        } else {
          wave = 'W3';
          for (const e of [1.618, 2.618]) targets.push({ wave: 'W3', note: `W3 = ${e}\u00D7W1`, price: p[2] + dir * e * w1 });
          targets.push({ wave: 'W3', note: 'W3 > W1 (min)', price: p[1] + dir * 0.25 * Math.abs(w1) });
          stop = p[0]; // R1 edge
        }
      } else if (n === 2) {
        wave = 'W2';
        for (const f of [0.618, 0.786, 0.5]) targets.push({ wave: 'W2', note: `W2 = ${pct(f)} of W1`, price: p[1] - dir * f * w1 });
        stop = p[0];
      } else {
        return null; // <2 pivots: not enough structure to project
      }
    } else if (kind === 'corrective' && n >= 3) {
      // A-B-C. dir = A->C. endB = p2, cExt = last pivot.
      const aLeg = Math.abs(p[1] - p[0]);
      const endB = p[2];
      const cExt = p[n - 1];
      const c1 = endB + dir * 1.0 * aLeg;
      const c1618 = endB + dir * 1.618 * aLeg;
      // C is considered DONE once it has reached its 1.0×A target (the classic C
      // terminal). Beyond that the NEXT move is a retracement of the whole A-B-C,
      // not a further C extension. (Before this the code kept projecting C past
      // 1.0×A — e.g. W1 was 1.25×A already but still told to "continue to 1×A".)
      const past = dir === 1 ? cExt >= c1 : cExt <= c1;
      if (!past && n >= 3) {
        // C has not reached its 1.0×A target -> CONTINUE C from the end of B.
        wave = 'C';
        targets.push({ wave: 'C', note: 'C = 1.0\u00D7A from B', price: c1 });
        if (Math.abs(c1618 - c1) > 1e-9) targets.push({ wave: 'C', note: 'C = 1.618\u00D7A from B', price: c1618 });
        // Harmonic read of the XABCD (A=p1,B=p2,C=p3): the AB=CD / Gartley D /
        // Bat D levels are the classic C-wave terminal zone (PRZ).
        targets.push(...harmonicD(p, dir));
        stop = endB - dir * 0.236 * aLeg; // beyond the B extreme (R1 for the C trade)
      } else {
        // C reached its 1.0×A target -> the next move is a RETRACEMENT.
        // Standard: price retraces the C wave (the last leg, B->C) at the classic
        // fibo levels; B and the A-origin are the structural floors for a long ABC.
        wave = 'RETRACE_ABC';
        retrace = true;
        const cWave = Math.abs(cExt - endB); // the C leg (B -> C)
        for (const f of [0.382, 0.5, 0.618]) targets.push({ wave: 'R', note: `retrace ${pct(f)} of C`, price: cExt - dir * f * cWave });
        targets.push({ wave: 'R', note: 'back to B', price: endB });
        targets.push({ wave: 'R', note: 'back to A origin', price: p[0] });
        stop = cExt + dir * 0.06 * cWave; // C still extending past its extreme -> retrace call void
      }
    } else return null;
    if (!targets.length) return null;
    // Wave-3 rule cap: W5 candidates may not extend past the cap (would make W3
    // the shortest of 1,3,5 -> invalid impulse).
    const cap = extra.find(e => e.note.indexOf('Wave-3 rule cap') === 0);
    const poolAll = targets.slice();
    const targets2 = cap ? targets.filter(t => dir === 1 ? t.price <= cap.price : t.price >= cap.price) : targets;
    if (cap && targets2.length === 0) targets2.push(targets[0]);
    // pick: directional from entry, cluster within 0.6%, nearest cluster clearing 1R
    // (else nearest, flagged). confluence = methods agreeing on the level.
    const tolPct = 0.6, minRR = 1.0;
    const fwd = targets2.filter(t => dir === 1 ? t.price > entry : t.price < entry);
    const pool = fwd.length ? fwd : targets2;
    const groups = confluence(pool.map(t => ({ price: t.price, countId: t.wave, label: t.note })), tolPct);
    const cands = [];
    for (const g of groups) cands.push({ price: g.price, confluence: g.members.length, note: g.members.map(m => m.label).join(' + ') });
    for (const t of pool) {
      if (!groups.some(g => Math.abs(g.price - t.price) / Math.max(1, t.price) * 100 <= tolPct))
        cands.push({ price: t.price, confluence: 1, note: t.note });
    }
    // For a RETRACE, the level moves AGAINST the C direction (dir reversed), so
    // re-scope "forward" to the retrace direction.
    let rdir = dir;
    if (retrace) {
      const rfwd = cands.filter(c => rdir === 1 ? c.price < entry : c.price > entry);
      if (rfwd.length) cands.length = 0, cands.push(...rfwd);
      rdir = -dir;
    }
    cands.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
    let predict = null, belowMinRR = false;
    for (const c of cands) {
      const rrv = stop != null ? rrCalc(entry, stop, c.price) : null;
      if (rrv == null || rrv >= minRR) { predict = { price: c.price, note: c.note, confluence: c.confluence, rr: rrv }; break; }
    }
    if (!predict && cands.length) { predict = { price: cands[0].price, note: cands[0].note, confluence: cands[0].confluence, rr: stop != null ? rrCalc(entry, stop, cands[0].price) : null }; belowMinRR = true; }
    if (predict) predict.t = pt[n - 1] + 3 * cadN; // display offset for the projected path
    return {
      wave, side: (retrace ? -dir : dir) === 1 ? 'long' : 'short', entry, stop,
      targets: poolAll, predict, belowMinRR, retrace: !!retrace,
      cap: cap ? cap.price : null,
      allCands: cands.slice(0, 6).map(c => ({ price: +c.price.toFixed(2), note: c.note, confluence: c.confluence }))
    };
  }

  // ---- ALL-TF READER (pivot detection + per-TF count) ---------------------
  // bars: [{t,o,h,l,c}] ; returns swing pivots + an auto 5-wave count of the
  // last visible structure + a short "what is this TF doing" read.
  function findPivots(bars, w) {
    w = w || Math.max(2, Math.round(bars.length / 40));
    const out = [];
    for (let i = w; i < bars.length - w; i++) {
      const b = bars[i], H = x => x.high ?? x.h, L = x => x.low ?? x.l;
      let hi = true, lo = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        if (H(bars[j]) >= H(b)) hi = false;
        if (L(bars[j]) <= L(b)) lo = false;
      }
      if (hi) out.push({ t: b.t, price: H(b), kind: 'H', i });
      if (lo) out.push({ t: b.t, price: L(b), kind: 'L', i });
    }
    out.sort((a, b) => a.i - b.i);
    const m = [];
    for (const p of out) {
      if (m.length && m[m.length - 1].kind === p.kind) {
        const last = m[m.length - 1];
        if (p.kind === 'H' ? p.price > last.price : p.price < last.price) m[m.length - 1] = p;
      } else m.push(p);
    }
    return m;
  }
  // Build the strongest 5-point count from the tail pivots (last up or down impulse).
  function autoCount(bars, w) {
    if (!bars || bars.length < 20) return null;
    let piv = findPivots(bars, w);
    if (piv.length < 6) return null;
    piv = piv.slice(-Math.min(piv.length, 12));
    const n = piv.length;
    const lastLeg = piv[n - 1].price - piv[n - 2].price;
    const dir = lastLeg > 0 ? 1 : -1;
    // find up-legs in direction
    const ups = [];
    for (let i = 1; i < n; i++) if ((piv[i].price - piv[i - 1].price) * dir > 0) ups.push(i);
    let type = 'zigzag', pts;
    if (ups.length >= 3) {
      const lens = ups.map(i => (piv[i].price - piv[i - 1].price) * dir);
      const strongest = lens.indexOf(Math.max(...lens));
      if (strongest === 1 && ups.length >= 3) type = 'impulse';
    }
    if (type === 'impulse') {
      const i3 = ups[1]; const start = i3 - 2;
      pts = piv.slice(Math.max(0, start)).slice(0, 5);
    } else pts = piv.slice(-4);
    const count = { type, dir, diagonal: false,
      pivots: pts.map(p => ({ t: p.t, price: p.price, time: p.t })) };
    const v = validate(count);
    const fc = forecast(count);
    return { piv, count, validation: v, forecast: fc, dir, type,
      last: bars[bars.length - 1] };
  }
  // Read a stack of TFs: {TF:bars} -> per-TF autoCount + confluence of targets.
  function scanTfs(byTf) {
    const rows = [];
    const allTargets = [];
    for (const tf in byTf) {
      const bars = byTf[tf];
      if (!bars || !bars.length) continue;
      const a = autoCount(bars);
      const row = { tf, n: bars.length, last: bars[bars.length - 1] };
      if (!a) { row.state = 'insufficient'; rows.push(row); continue; }
      row.state = a.validation.valid ? 'valid' : (a.validation.inProgress ? 'in-progress' : 'check');
      row.type = a.type; row.dir = a.dir;
      row.pivots = a.count.pivots;
      row.validation = a.validation;
      // key targets
      row.targets = [];
      if (a.forecast) {
        (a.forecast.remaining || []).forEach(r => { row.targets.push(r); allTargets.push({ tf, price: r.price, label: r.wave + ' ' + r.note }); });
        row.scenarios = a.forecast.scenarios;
        row.confluence = a.forecast.confluence;
      }
      rows.push(row);
    }
    rows.sort((a, b) => (a.tf < b.tf ? 1 : -1));
    return { rows, confluence: confluence(allTargets.map(t => ({ price: t.price, countId: t.tf, label: t.tf + ' ' + t.label })), 0.8) };
  }

  // ---- E1 (2026-11-12) — pro-channel upgrades --------------------------------
  // MotiveWave degree ladder (EWM's blue→purple→green): lower degree = finer print.
  const DEGREES = ['motive', 'sub', 'paren', 'letter', 'roman'];
  const DEGREE_COLORS = ['#4da3ff', '#b07cff', '#37c978', '#ff5d5d', '#ffd166'];
  // EWSTRAT two-color semantics on top: impulse = blue, correction = red.
  const PHASE_COLORS = { impulse: '#4da3ff', correction: '#ff5d5d' };
  function degreeFor(type) {
    if (type === 'impulse') return 0;      // 1-5
    if (type === 'sub') return 1;           // (i)-(v)
    if (type === 'diagonal') return 2;      // {i}-...
    return 3;                               // A/B/C, W/X/Y (letters)
  }
  function degreeLabels(count) {
    const type = (TYPES[count.type] || {}).kind;
    const deg = degreeFor(count.type);
    return (TYPES[count.type] || { labels: [] }).labels.map((lbl, i) => ({
      label: lbl, i,
      color: DEGREE_COLORS[deg],
      phase: type === 'motive' ? PHASE_COLORS.impulse : PHASE_COLORS.correction,
      degree: DEGREES[deg],
    }));
  }
  // "Red or Blue?" — two competing counts of the SAME structure. The split level is the
  // price where ONE count dies (its invalidation); crossing it flips the active scenario.
  function compete(a, b, price = null) {
    // accepts either a count ({type,dir,pivots}) or an autoCount result ({count,validation,forecast,dir})
    const norm = x => {
      const count = x.count || x;
      const validation = x.validation || { violations: 0 };
      const forecast = x.forecast || null;
      const piv = count.pivots;
      return { dir: count.dir || x.dir || 1,
               valid: !validation.violations,
               last: piv[piv.length - 1].price,
               invalidation: (forecast && forecast.scenarios && forecast.scenarios[0] && forecast.scenarios[0].stop) || piv[0].price };
    };
    const A = { name: 'A', ...norm(a) };
    const B = { name: 'B', ...norm(b) };
    const out = { A, B, splitLevel: null, winner: 'open', note: '' };
    if (A.dir !== B.dir) {
      // opposing scenarios: the split is the level that invalidates the favored side.
      // Favored = the structurally valid one (if any); else the one price is closer to.
      const fav = A.valid && !B.valid ? A : (B.valid && !A.valid ? B : (price != null ? (Math.abs(price - A.last) <= Math.abs(price - B.last) ? A : B) : A));
      out.splitLevel = +fav.invalidation.toFixed(2);
      out.winner = 'open';
      out.note = `split at ${fav.invalidation.toFixed(2)} — ${fav.name} dies there; opposite takes over`;
      if (price != null) {
        const favOk = fav === A ? (A.dir === 1 ? price > A.invalidation : price < A.invalidation)
                                : (B.dir === 1 ? price > B.invalidation : price < B.invalidation);
        out.winner = favOk ? fav.name : (fav === A ? 'B' : 'A');
      }
    } else {
      // same direction, different structure (e.g. triangle-end vs correction-over):
      // split = the higher of the two invalidations (the level where the weaker dies first).
      out.splitLevel = +Math.max(A.invalidation, B.invalidation).toFixed(2);
      out.note = `both ${A.dir === 1 ? 'up' : 'down'} — different structure; split at ${out.splitLevel}`;
      if (price != null) out.winner = (price === out.splitLevel) ? 'open' : ((A.dir === 1) === (price > out.splitLevel) ? 'A' : 'B');
    }
    return out;
  }
  // Revision discipline: counts change ONLY when price crosses a published invalidation.
  // Diff the last published fingerprint vs the fresh autoCount; emit a dated line + one
  // yes/no "Trader's Question" per snapshot (EWM article format).
  function countFingerprint(x) {
    const count = x.count || x; // accept a count or an autoCount result
    const p = count.pivots.map(q => +q.price.toFixed(2));
    return { type: count.type, dir: count.dir, last: p[p.length - 1], n: p.length };
  }
  function revisionDiff(prev, cur, now = '') {
    const curCount = cur.count || cur;
    if (!prev) {
      return { changed: false, first: true, note: `first published count: ${curCount.type} dir ${(curCount.dir || cur.dir) === 1 ? 'UP' : 'DOWN'}`,
               question: null };
    }
    const a = countFingerprint(prev), b = countFingerprint(cur);
    const same = a.type === b.type && a.dir === b.dir && a.last === b.last;
    if (same) {
      return { changed: false, first: false, note: 'unchanged — no revision', question: null };
    }
    const why = a.dir !== b.dir ? 'direction flipped' : (a.type !== b.type ? `count type ${a.type} → ${b.type}` : `structure moved (last pivot ${a.last} → ${b.last})`);
    const fc = cur.forecast || curCount.forecast;
    const sc = fc && fc.scenarios && fc.scenarios[0];
    const q = sc ? `Does price hold ${sc.side === 'long' ? 'above' : 'below'} ${sc.stop.toFixed(2)} (the invalidation)?` : null;
    return { changed: true, first: false, note: `REVISION ${now || ''}: ${why}`, question: q };
  }

  // ---- E1.2 (2026-11-12) — prediction primitives -----------------------------------
  // The study's conclusion: a count is only tradeable when (a) the stop is STRUCTURAL
  // (a level the count itself says is the edge — "you are a risk manager, not a
  // forecaster"), (b) the target is a CONFLUENCE level (2-3 methods agreeing), and
  // (c) the higher degree agrees (bias gate). These three functions are the engine's
  // prediction layer — pure, deterministic, and the exact levels the backtest scores.

  // (a) Structural stop: the level where the CURRENT count dies, respecting the wave
  //     we're in. Motive: a long is dead when price re-enters wave-4 territory — the
  //     EWSTRAT "wave 4 cannot enter wave 1's territory" rule, used as the stop. A
  //     corrective long (ABC) is dead below the C terminus origin (A start).
  //     Returns { level, basis, minDist } — minDist is a noise floor so a stop is never
  //     tighter than a small fraction of the count's own W1 length.
  function structStop(count, price = null) {
    const p = count.pivots.map(q => q.price);
    const t = count.pivots.map(q => q.t || q.time);
    const n = p.length;
    const dir = count.dir || 1;
    const kind = (TYPES[count.type] || {}).kind;
    const w1 = Math.abs(p[1] - p[0]) || Math.abs(p[n - 1] - p[0]);
    const minDist = Math.max(0.06 * w1, price ? Math.abs(p[n - 1] - price) * 0 : 0); // 6% of W1 as noise floor
    let level = null, basis = '';
    if (kind === 'motive') {
      if (dir === 1) {
        // long: dead when price closes back under the W4 LOW (wave-4 territory / W1-origin
        // re-entry — whichever is the nearer structural edge). For n>=5 the W4 low is p[3];
        // in-progress (n==4) use the W1 origin p[0].
        level = n >= 5 ? Math.min(p[3], p[0]) : p[0];
        basis = n >= 5 ? 'wave-4 territory (W4 low / W1 origin)' : 'W1 origin (in progress)';
      } else {
        level = n >= 5 ? Math.max(p[3], p[0]) : p[0];
        basis = n >= 5 ? 'wave-4 territory (W4 high / W1 origin)' : 'W1 origin (in progress)';
      }
    } else {
      // corrective: dead beyond the C origin (the A start) against the count direction
      level = dir === 1 ? p[0] : p[0];
      basis = 'A origin (corrective edge)';
    }
    // enforce the noise floor on the correct side of the entry
    const entry = price != null ? price : p[n - 1];
    if (dir === 1 && level > entry - minDist) level = entry - minDist;
    if (dir === -1 && level < entry + minDist) level = entry + minDist;
    return { level: +level.toFixed(2), basis, minDist: +minDist.toFixed(2), dir, entry };
  }

  // (b) Confluence-weighted target: cluster the forecast's remaining levels (2+ methods
  //     agreeing within tolPct = the "level where 2-3 TFs/methods agree" the pros call
  //     the trade) and return the nearest cluster that is a valid R:R in the count's
  //     direction. Falls back to the primary single-method target when no cluster exists.
  function pickTarget(count, forecast, opts = {}) {
    const tolPct = opts.tolPct != null ? opts.tolPct : 0.6;
    const minRR = opts.minRR != null ? opts.minRR : 1.0;
    const entry = opts.entry != null ? opts.entry : count.pivots[count.pivots.length - 1].price;
    const dir = count.dir || 1;
    const stop = opts.stop != null ? opts.stop : (forecast && forecast.scenarios && forecast.scenarios[0] && forecast.scenarios[0].stop);
    if (!forecast || !forecast.remaining || !forecast.remaining.length) {
      return { price: null, confluence: 0, rr: null, note: 'no remaining levels' };
    }
    // only levels in the count's direction from entry are candidates
    const fwd = forecast.remaining.filter(r => dir === 1 ? r.price > entry : r.price < entry);
    if (!fwd.length) return { price: null, confluence: 0, rr: null, note: 'no forward levels' };
    const groups = confluence(fwd.map(r => ({ price: r.price, countId: r.wave + '·' + r.note, label: r.wave + ' ' + r.note })), tolPct);
    // candidates = cluster means (confluence levels) + single-method forward levels;
    // pick the NEAREST one to entry that clears minRR (nearest valid = the level a
    // disciplined trader actually books, per the pro channels).
    const cands = [];
    for (const g of groups) cands.push({ price: g.price, confluence: g.members.length, note: g.members.length + ' methods @ ' + g.price });
    for (const r of fwd) {
      if (!groups.some(g => Math.abs(g.price - r.price) / Math.max(1, r.price) * 100 <= tolPct)) {
        cands.push({ price: r.price, confluence: 1, note: r.wave + ' ' + r.note });
      }
    }
    cands.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
    for (const c of cands) {
      const rrv = stop != null ? rrCalc(entry, stop, c.price) : null;
      if (rrv == null || rrv >= minRR) return { price: c.price, confluence: c.confluence, rr: rrv, note: c.note };
    }
    // nothing clears minRR: report the nearest candidate (flagged) so callers can downgrade
    const c0 = cands[0];
    return { price: c0.price, confluence: c0.confluence, rr: stop != null ? rrCalc(entry, stop, c0.price) : null, note: c0.note + ' (below minRR)', belowMinRR: true };
  }
  function rrCalc(entry, stop, target) {
    const risk = Math.abs(entry - stop);
    if (!risk) return null;
    return +((Math.abs(target - entry) / risk).toFixed(2));
  }

  // Harmonic ABCD (AB=CD) + Gartley D targets from an A-B-C (X-A-B-C) structure.
  // X=A-origin, A=p1, B=p2, C=p3. dir = the A->C leg direction.
  function harmonicD(p, dir) {
    const out = [];
    const xa = p[1] - p[0];               // signed in dir terms below
    const xaLen = Math.abs(xa);
    if (xaLen < 1e-9) return out;
    // AB=CD: CD length = |A-B| projected from C -> the standard zigzag C target
    out.push({ note: 'AB=CD', price: p[3] + dir * Math.abs(p[2] - p[1]) });
    // Gartley: D at 0.786 retrace of XA (from the A extreme back toward X)
    out.push({ note: 'Gartley D 0.786×XA', price: p[1] - dir * 0.786 * xaLen });
    // Bat: D at 0.886 retrace of XA
    out.push({ note: 'Bat D 0.886×XA', price: p[1] - dir * 0.886 * xaLen });
    return out;
  }

  // (c) HTF bias gate: the pro method "establish the highest degree first." Pass the
  //     HIGHER-degree trend direction (e.g. D1 or H4 count direction) and the LTF count
  //     you want to trade; returns { aligned, note }. A counter-degree trade is downgraded
  //     to WATCH, not dropped — the EWSTRAT "cross-asset driver / dollar first" discipline.
  function htfBias(htfDir, ltfDir, opts = {}) {
    if (!htfDir) return { aligned: null, note: 'no HTF count (gate off)' };
    if (htfDir === ltfDir) return { aligned: true, note: 'HTF + LTF aligned' };
    if (opts.allowCounter) return { aligned: false, note: 'counter-degree (watch, not dropped)' };
    return { aligned: false, note: 'counter-degree — downgraded to WATCH' };
  }

  // Composite: the full "tradeable?" verdict for a count, combining (a)+(b)+(c).
  // This is the single object the backtest and the BBMA enhancer consume.
  function tradeable(count, forecast, opts = {}) {
    const ss = structStop(count, opts.price);
    const tgt = pickTarget(count, forecast, { entry: opts.price, stop: ss.level, minRR: opts.minRR != null ? opts.minRR : 1.0 });
    const bias = htfBias(opts.htfDir, ss.dir, { allowCounter: opts.allowCounter });
    const ok = !!(tgt.price && (tgt.rr == null || tgt.rr >= 1.0)) && (bias.aligned === true || bias.aligned === null);
    return { ok, stop: ss, target: tgt, bias, entry: ss.entry };
  }
  const api = { TYPES, validate, targets, channel, confluence, rr, forecast, findPivots, autoCount, scanTfs, EXT, RET,
                degreeLabels, compete, revisionDiff, countFingerprint, DEGREE_COLORS, DEGREES, PHASE_COLORS,
                structStop, pickTarget, htfBias, tradeable, nextWave };
  return api;
});
