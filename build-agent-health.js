'use strict';

const fs = require('fs');

function read(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function ageMs(timestamp, now = Date.now()) {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? Math.max(0, now - value) : null;
}

function freshnessState(age, maxAge) {
  return age == null ? 'MISSING' : age <= maxAge ? 'OK' : 'STALE';
}

function finiteOrNull(value) {
  return Number.isFinite(+value) ? +value : null;
}

const watch = read('data/bbma-watch.json');
const intel = read('data/intelligence-360.json');
const perf = read('data/bbma-performance.json');
const now = Date.now();

const accuracy = perf.overall ? finiteOrNull(perf.overall.accuracyPct) : null;
const pending = finiteOrNull(perf.pending);
const settled = finiteOrNull(perf.settled);

const out = {
  schemaVersion: 1,
  generatedAt: new Date(now).toISOString(),
  agents: {
    market: {
      state: freshnessState(ageMs(watch.generatedAt, now), 30 * 60000),
      lastSuccess: watch.generatedAt || null,
      gaps: finiteOrNull(watch.source && watch.source.gaps) || 0,
      duplicates: finiteOrNull(watch.source && watch.source.duplicates) || 0
    },
    intelligence: {
      state: intel.status || 'MISSING',
      lastSuccess: intel.generatedAt || null,
      conflicts: Array.isArray(intel.conflicts) ? intel.conflicts : []
    },
    learning: {
      state: perf.generatedAt ? freshnessState(ageMs(perf.generatedAt, now), 24 * 60 * 60000) : 'MISSING',
      pending: pending == null ? 0 : pending,
      settled: settled == null ? 0 : settled,
      accuracyPct: accuracy
    }
  }
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/agent-health.json', JSON.stringify(out, null, 2));
console.log('agent health built');
