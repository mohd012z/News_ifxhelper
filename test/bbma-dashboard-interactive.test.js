'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
// Elements/behaviours the SHIPPED dashboard actually implements.
['bbma-filter','bbma-news','bbma-tfs','bbma-matrix','bbma-alert-evidence','data-tf','data-pattern','data-alert-id','MYT','RE-ENTRY','CSA','MHV','EXTREME','BBMA_CHART_NO_DATA'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes("addEventListener('click'"),'interactive click handling missing');
// State machine: stale/no-live data must read as STALE, and the chart must
// degrade to an honest NO_DATA state instead of rendering invented candles.
assert(s.includes("d.source==='NONE'")||s.includes('source:'),'no-source staleness check missing');
assert(s.includes('BBMA_CHART_NO_DATA'),'chart NO_DATA state missing');
// Price labels on the chart: axis gridlines + last-price tag must render.
assert(s.includes('bbma-axis')&&s.includes('class="ll"'),'chart price axis / last-price label missing');
assert(s.includes('toFixed(2)'),'price labels must show 2 decimals');
// Session-open markers: UTC-authority, MYT-display, DST-aware (per canonical contract).
assert(s.includes('sessions(x,f)'),'session marker function missing');
assert(s.includes('TOKYO 08:00'),'Tokyo open marker missing (09:00 JST = 08:00 MYT)');
assert(s.includes('US '),'US cash-open marker missing');
assert(s.includes('nthSunday'),'US open must be DST-aware (2nd Sunday March / 1st Sunday November)');
// Matrix: BB zone and candle location must be SEPARATE columns (were conflated).
assert(s.includes('LOC/EVT'),'matrix must split zone vs location into own columns');
assert(!s.includes("z.zone||z.location"),'matrix must not conflate zone and location again');
// Canonical 7-state zone model lives in the RUNTIME (parity with lib/bbma-candle-watch.js)
const r=fs.readFileSync('bbma-runtime.js','utf8');
/* The canonical 7-state zone model lives ONCE in lib/bbma-engine.js (the
 * authority); the runtime DELEGATES to it (PHASE B). The runtime source no
 * longer carries the full zone literal table — engine==builder==runtime zone
 * agreement is proven by test/bbma-zone-parity.test.js +
 * test/bbma-parity-fixtures.test.js. Here we assert the DELEGATION, which is
 * the stronger guarantee (one implementation, not two that must match). */
const engSrc=fs.readFileSync('lib/bbma-engine.js','utf8');
['ABOVE_TOP_BB','BELOW_LOW_BB','TOP_BB','LOW_BB','MID_BB','INSIDE_BB','EMA50'].forEach(z=>assert(engSrc.includes(z),'canonical zone state missing in engine: '+z));
assert(r.includes('canon.zone'),'runtime must READ the canonical engine zone (delegation, not a second table)');
assert(!r.includes("'UPPER_BAND'"),'old crude UPPER_BAND/LOWER_BAND zone must be gone');
assert(!r.includes('MID_BB_BOUNCE'),'old tautological location labels must be gone');
/* PHASE B: the tolerance constants now live ONCE in the canonical engine;
 * the runtime must delegate, not re-define them. */
assert(engSrc.includes('0.00015')&&engSrc.includes('0.03'),'tolerance constants live in the canonical engine (3% band width / 0.015% price)');
assert(!r.includes('0.00015'),'runtime must not carry its own tolerance constant (single authority)');
console.log('interactive BBMA dashboard contract passed');
