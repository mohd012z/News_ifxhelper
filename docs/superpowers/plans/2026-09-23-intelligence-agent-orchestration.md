# Intelligence Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing News_ifxhelper BBMA/news modules into a coordinated, persistent, self-validating intelligence pipeline with explicit freshness, fallback/conflict state, and empirically calibrated one-step-ahead research evidence.

**Architecture:** Keep existing focused engines and add a small normalized evidence/orchestration layer around them. Scheduled jobs produce deterministic persisted observations and compact snapshots; no agent may convert stale/conflicting evidence into directional certainty. The UI/APK consumes one coherent intelligence snapshot rather than independently interpreting raw files.

**Tech Stack:** Node.js 22, CommonJS, GitHub Actions, JSON/JSONL persistence, existing Capacitor web/APK application.

**Spec:** `docs/superpowers/specs/2026-09-23-intelligence-agent-orchestration.md`

## Global Constraints
- Heuristic confidence and empirical accuracy remain separate fields.
- Empirical accuracy is publishable only when comparable `sampleSize >= 20`.
- Learning inputs must be closed candles with acceptable quality.
- Stable deterministic IDs prevent duplicate observations from overlapping cron runs.
- Unresolved source disagreement publishes `CONFLICT/UNKNOWN`, never a forced direction.
- Every accepted evidence item preserves provider, sourceAt, fetchedAt, latency, quality, freshness, fallback and conflict state.
- Cached APK data must expose source timestamp and `STALE/OFFLINE` when refresh fails.
- M30 remains the H1-to-M15 BBMA bridge timeframe.

## Review Focus
1. A provider returns HTTP 200 but an old candle: it must be classified stale rather than healthy; Task 2 tests this.
2. Two overlapping cron runs create the same prediction: only one deterministic observation survives; Task 5 tests this.
3. A prediction is accidentally settled against a later candle instead of the exact next timeframe candle: settlement must refuse it; Task 5 tests this.
4. Primary and fallback prices materially disagree: orchestration must publish conflict/unknown and callback-required; Task 3 tests this.
5. APK/web cannot refresh but has cached data: UI snapshot must retain data while explicitly marking it stale/offline; Task 8 tests this.

---

## File Structure

**Create**
- `lib/evidence-envelope.js` — normalized agent evidence contract and deterministic evidence IDs.
- `lib/source-health.js` — freshness, provider-health and source acceptance gates.
- `lib/intelligence-orchestrator.js` — dependency ordering, fallback/callback and merged 360 state.
- `lib/learning-store.js` — deterministic pending/settled observation persistence helpers.
- `build-intelligence-360.js` — hourly coherent snapshot publisher.
- `build-bbma-learning.js` — settle/create/dedupe learning cycle and performance output.
- `build-agent-health.js` — daily source/workflow/learning health summary.
- `build-intelligence-aggregate.js` — weekly/monthly grouped historical summaries.
- `test/evidence-envelope.test.js`
- `test/source-health.test.js`
- `test/intelligence-orchestrator.test.js`
- `test/learning-store.test.js`
- `test/intelligence-builders.test.js`
- `.github/workflows/intelligence-360.yml`
- `.github/workflows/learning-health.yml`
- `.github/workflows/intelligence-aggregate.yml`

**Modify**
- `lib/bbma-learning.js` — exact-next-candle settlement guard and calibrated evidence metadata.
- `build-bbma-watch.js` — call learning cycle and emit normalized market/BBMA evidence.
- `.github/workflows/bbma-watch.yml` — preserve 15-minute market job while preventing malformed writes.
- `package.json` — add all new tests/build scripts to the master verification chain.
- `app.js` — consume coherent intelligence/health/performance snapshots.
- `index.html` — add agent-health/360/learning containers without duplicating existing dashboard controls.
- `bbma-news-dashboard.js` — render freshness/conflict/sample/calibration states.
- `bbma-news-dashboard.css` — responsive states for healthy/degraded/conflict/stale/offline.

---

### Task 1: Standard Evidence Envelope

**Files:**
- Create: `lib/evidence-envelope.js`
- Test: `test/evidence-envelope.test.js`

**Interfaces:**
- Produces: `makeEvidence(input) -> EvidenceEnvelope`, `evidenceId(input) -> string`, `mergeConflicts(items) -> string[]`.

- [ ] **Step 1: Write the failing contract test**

```js
const assert=require('assert');
const E=require('../lib/evidence-envelope');
const a=E.makeEvidence({agent:'MARKET',source:'A',sourceAt:'2026-09-23T01:00:00Z',fetchedAt:'2026-09-23T01:00:01Z',quality:'EXACT',status:'ACCEPTED',evidence:[{kind:'price',value:100}]});
const b=E.makeEvidence({agent:'MARKET',source:'A',sourceAt:'2026-09-23T01:00:00Z',fetchedAt:'2026-09-23T01:00:02Z',quality:'EXACT',status:'ACCEPTED',evidence:[{kind:'price',value:100}]});
assert.equal(a.id,b.id);
assert.equal(a.latencyMs,1000);
assert.deepEqual(E.mergeConflicts([{conflicts:['PRICE']},{conflicts:['PRICE','TIME']}]),['PRICE','TIME']);
```

- [ ] **Step 2: Run `node test/evidence-envelope.test.js` and verify it fails because the module does not exist.**

- [ ] **Step 3: Implement deterministic IDs from agent/source/sourceAt/evidence identity; normalize required fields; derive latency from timestamps only when valid; deduplicate conflicts.**

- [ ] **Step 4: Run the test and verify PASS.**

- [ ] **Step 5: Commit `feat: add normalized intelligence evidence envelope`.**

### Task 2: Source Health and Freshness Gate

**Files:**
- Create: `lib/source-health.js`
- Test: `test/source-health.test.js`

**Interfaces:**
- Consumes: normalized timestamps/evidence from Task 1.
- Produces: `assessSource({sourceAt,fetchedAt,now,maxAgeMs,quality})`, `acceptSource(primary,fallback,opts)`.

- [ ] **Step 1: Add tests for fresh data, HTTP-fast-but-stale data, malformed timestamps, forming candles and fallback acceptance.**

```js
assert.equal(H.assessSource({sourceAt:'2026-09-23T00:00:00Z',fetchedAt:'2026-09-23T02:00:00Z',now:Date.parse('2026-09-23T02:00:00Z'),maxAgeMs:60000,quality:'EXACT'}).freshness,'STALE');
assert.equal(H.assessSource({sourceAt:'2026-09-23T01:59:30Z',fetchedAt:'2026-09-23T02:00:00Z',now:Date.parse('2026-09-23T02:00:00Z'),maxAgeMs:60000,quality:'FORMING'}).accepted,false);
```

- [ ] **Step 2: Run test and confirm FAIL.**
- [ ] **Step 3: Implement freshness as source-time age, not HTTP duration; reject INVALID/FORMING; return `FRESH/STALE/MISSING` and acceptance reason.**
- [ ] **Step 4: Run test and confirm PASS.**
- [ ] **Step 5: Commit `feat: add source freshness and acceptance gates`.**

### Task 3: Fallback, Callback and 360 Orchestrator

**Files:**
- Create: `lib/intelligence-orchestrator.js`
- Test: `test/intelligence-orchestrator.test.js`

**Interfaces:**
- Consumes: Task 1 envelopes and Task 2 health results.
- Produces: `resolveSources(primary,fallback,crossCheck)`, `orchestrate(inputs) -> Intelligence360`.

- [ ] **Step 1: Test `PRIMARY_OK -> ACCEPTED`, stale primary + healthy fallback -> `DEGRADED_ACCEPTED`, and materially conflicting providers -> `CONFLICT`, `callbackRequired=true`, directional state `UNKNOWN`.**
- [ ] **Step 2: Run test and confirm FAIL.**
- [ ] **Step 3: Implement the exact state machine from the spec; preserve both providers and conflict reasons in output.**
- [ ] **Step 4: Add a malformed-source test proving orchestration fails closed instead of throwing away the whole snapshot.**
- [ ] **Step 5: Run test and confirm PASS.**
- [ ] **Step 6: Commit `feat: add intelligence fallback and conflict orchestrator`.**

### Task 4: Emit Normalized Market/BBMA/News Evidence

**Files:**
- Modify: `build-bbma-watch.js`
- Modify: `lib/bbma-candle-watch.js`
- Test: extend `test/market-provider.test.js`, `test/ohlc-backfill.test.js`, `test/bbma-learning.test.js`

**Interfaces:**
- Consumes: existing provider, validator, resampler, BBMA, news-proximity engines plus Task 1.
- Produces: `data/bbma-watch.json` schema v3 with `marketEvidence`, `bbmaEvidence`, `newsEvidence` and backward-compatible `analysis/dashboard`.

- [ ] **Step 1: Add failing assertions that every published evidence block contains sourceAt/fetchedAt/quality/freshness/status and that a forming source candle cannot create a 1-step observation.**
- [ ] **Step 2: Run focused tests and confirm FAIL.**
- [ ] **Step 3: Modify builder to derive evidence from the last closed validated candle; retain existing UI fields during migration.**
- [ ] **Step 4: Add assertion that M30 analysis is present only when its source bucket is complete.**
- [ ] **Step 5: Run focused tests and confirm PASS.**
- [ ] **Step 6: Commit `feat: publish normalized BBMA watch evidence`.**

### Task 5: Durable One-Step Learning Cycle

**Files:**
- Create: `lib/learning-store.js`
- Create: `build-bbma-learning.js`
- Modify: `lib/bbma-learning.js`
- Test: `test/learning-store.test.js`

**Interfaces:**
- Produces: `upsertObservation(rows,obs)`, `exactNextCandle(obs,frames)`, `settleDue(rows,frames)`, `performance(rows)`.
- Outputs: `data/bbma-learning.json`, `data/bbma-performance.json`.

- [ ] **Step 1: Write failing tests for deterministic duplicate upsert, exact-next-candle settlement, refusal to settle against a skipped/later candle, and no mutation of already settled rows.**

```js
const rows=[];S.upsertObservation(rows,obs);S.upsertObservation(rows,obs);assert.equal(rows.length,1);
assert.equal(S.exactNextCandle({...obs,tf:'M30',candleTime:'2026-09-23T01:00:00Z'},{M30:[{time:'2026-09-23T02:00:00Z'}]}),null);
```

- [ ] **Step 2: Run test and confirm FAIL.**
- [ ] **Step 3: Implement timeframe-duration mapping and require `next.time === candleTime + timeframeDuration`; never use merely the first later candle.**
- [ ] **Step 4: Implement atomic builder behavior: read existing history, settle due observations, create only eligible closed-candle observations, dedupe, then write complete JSON files.**
- [ ] **Step 5: Add tests that fewer than 20 comparable samples publish `empiricalAccuracy=null` plus `INSUFFICIENT_SAMPLES`; 20+ publish measured accuracy.**
- [ ] **Step 6: Run tests and confirm PASS.**
- [ ] **Step 7: Commit `feat: persist and settle BBMA one-step learning`.**

### Task 6: Hourly Intelligence-360 Publisher

**Files:**
- Create: `build-intelligence-360.js`
- Create: `test/intelligence-builders.test.js`
- Create: `.github/workflows/intelligence-360.yml`

**Interfaces:**
- Consumes: `bbma-watch`, economic/news data, cross-asset/conflict engines, `bbma-performance`.
- Produces: `data/intelligence-360.json`.

- [ ] **Step 1: Add fixture-based test where technical evidence is UP, economic evidence is DOWN and provider data conflict exists; expected overall state is `CONFLICT/UNKNOWN`, not UP or DOWN.**
- [ ] **Step 2: Run test and confirm FAIL.**
- [ ] **Step 3: Implement publisher with schema version, generatedAt, lastSuccessfulSync, agent states, unresolved conflicts, one-step raw state and empirical evidence.**
- [ ] **Step 4: Add hourly workflow (`cron: '7 * * * 1-5'`) that runs `npm ci`, `npm test`, builder, JSON sanity validation, then commits only changed valid output.**
- [ ] **Step 5: Run test and confirm PASS.**
- [ ] **Step 6: Commit `feat: publish hourly intelligence 360 snapshot`.**

### Task 7: Daily Health + Weekly/Monthly Aggregation

**Files:**
- Create: `build-agent-health.js`
- Create: `build-intelligence-aggregate.js`
- Create: `.github/workflows/learning-health.yml`
- Create: `.github/workflows/intelligence-aggregate.yml`
- Extend: `test/intelligence-builders.test.js`

**Interfaces:**
- Produces: `data/agent-health.json`, `data/intelligence-weekly.json`, `data/intelligence-monthly.json`.

- [ ] **Step 1: Add tests for stale source, unresolved pending observation, duplicate IDs, missing checkpoints and confidence-vs-accuracy drift.**
- [ ] **Step 2: Run test and confirm FAIL.**
- [ ] **Step 3: Implement daily health summary with per-agent `OK/DEGRADED/STALE/CONFLICT`, last success, failure reason and counts.**
- [ ] **Step 4: Implement aggregation grouped by event category, timeframe, news mode, BB location, squeeze and BBMA pattern; derive only from settled persisted observations.**
- [ ] **Step 5: Add daily workflow and weekly/monthly schedules; ensure concurrency groups differ from the 15-minute writer and each output has one owning workflow.**
- [ ] **Step 6: Run tests and confirm PASS.**
- [ ] **Step 7: Commit `feat: add intelligence health and historical aggregation`.**

### Task 8: Dashboard and APK Synchronization

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `bbma-news-dashboard.js`
- Modify: `bbma-news-dashboard.css`
- Test: extend `test/bbma-dashboard.test.js`

**Interfaces:**
- Consumes: `data/intelligence-360.json`, `data/agent-health.json`, `data/bbma-performance.json`.

- [ ] **Step 1: Add rendering tests/fixture assertions for `FRESH`, `DEGRADED`, `CONFLICT`, `STALE`, `OFFLINE`, sample-size suppression and calibration warning.**
- [ ] **Step 2: Run dashboard test and confirm FAIL.**
- [ ] **Step 3: Add compact Agent Health row, MTF matrix with M30 bridge emphasis, news mode/event block, provider/fallback indicator, unresolved conflict panel, raw 1-step state and empirical sample/accuracy block.**
- [ ] **Step 4: Change fetch/cache behavior so failed refresh keeps last cached snapshot but calculates age and visibly labels `STALE/OFFLINE`; never replace timestamp with current device time.**
- [ ] **Step 5: Run dashboard test and confirm PASS.**
- [ ] **Step 6: Run `npm run prepare-web` and inspect generated web bundle references for all three new data files.**
- [ ] **Step 7: Commit `feat: synchronize 360 intelligence dashboard and APK cache`.**

### Task 9: Master Verification and Workflow Revalidation

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/bbma-watch.yml`
- Test: all test files.

**Interfaces:**
- Produces: one reproducible master verification command and protected scheduled publishers.

- [ ] **Step 1: Add `test:evidence-envelope`, `test:source-health`, `test:orchestrator`, `test:learning-store`, and `test:intelligence-builders` scripts and include them in `npm test`.**
- [ ] **Step 2: Run `npm test`; expected result is zero failures. Do not claim green without captured successful output.**
- [ ] **Step 3: Run `node build-bbma-watch.js`, `node build-bbma-learning.js`, `node build-intelligence-360.js`, `node build-agent-health.js`, and `node build-intelligence-aggregate.js` against test-safe/current data; parse every generated JSON file with Node.**
- [ ] **Step 4: Re-run `npm test` after generated files exist to catch state-dependent failures.**
- [ ] **Step 5: Inspect workflow YAML for unique concurrency groups, output ownership, weekday schedules and validation-before-commit.**
- [ ] **Step 6: Trigger/observe GitHub Actions when branch execution is available; inspect failing job logs rather than assuming local/code review equals runtime success.**
- [ ] **Step 7: Commit `test: complete intelligence orchestration verification`.**

## Final Acceptance Checklist
- [ ] Primary outage uses fallback and is visibly degraded.
- [ ] Primary+fallback conflict produces `CONFLICT/UNKNOWN`.
- [ ] Calendar outage does not erase technical state but marks news evidence unavailable.
- [ ] Missing/duplicate/forming M1 data cannot silently create trusted BBMA learning observations.
- [ ] Delayed cron selects exact historical candles.
- [ ] Duplicate cron runs cannot duplicate learning IDs.
- [ ] Exact-next-candle settlement is enforced.
- [ ] `<20` comparable samples suppress empirical percentage.
- [ ] Confidence calibration is visible when raw confidence diverges from observed accuracy.
- [ ] Weekly/monthly summaries are derived only from settled observations.
- [ ] Web/APK stale cache is explicitly timestamped and labeled.
- [ ] `npm test` passes after all builders execute.
- [ ] Scheduled publishers validate JSON before committing.
