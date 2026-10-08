'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build-news.js'), 'utf8');

assert(!app.includes('manifest.schemaVersion !== 1'), 'client must not pin manifest schemaVersion === 1');
assert(app.includes('schemaVersion < 1 || schemaVersion > 3'), 'client must explicitly accept supported manifest schema versions through v3');
assert(app.includes('function replaceAuto(list, extra, key)'), 'remote sync must replace prior auto snapshot');
assert(app.includes('filter(function (x) { return !x.auto; })'), 'remote sync must preserve curated rows while removing old auto rows');

for (const view of ['today', 'week', 'month', 'upcoming', 'past']) {
  assert(index.includes('data-view="' + view + '"'), 'missing calendar view: ' + view);
}
assert(index.includes('id="alerts-month"'), 'monthly alert bucket must be visible');
assert(index.includes('id="calendar-source-status"'), 'calendar freshness/horizon status must be visible');

assert(build.includes('ff_calendar_thisweek.json'), 'current-week calendar feed missing');
assert(build.includes('ff_calendar_nextweek.json'), 'next-week calendar feed missing');
assert(build.includes('calendarAll'), 'full calendar snapshot missing');
assert(build.includes('incoming: calendar,'), 'priority incoming list must be emitted without hard-coded truncation');
assert(!build.includes('calendar.slice(0, 12)'), 'calendar must not drop later events with slice(0, 12)');
assert(build.includes('reminderLeadMinutes'), 'impact-aware reminder metadata missing');
assert(build.includes("importance === 'high' ? 15 : (importance === 'med' ? 10 : 5)"), 'Telegram-inspired 15/10/5 reminder cadence missing');

console.log('news period refresh v2 tests passed');
