'use strict';

const assert = require('assert');
const FF = require('../lib/forexfactory-calendar');

const html = `
<html><body>
<div>Calendar Time Zone: America/Chicago (GMT -5)</div>
<table class="calendar__table"><tbody>
<tr class="calendar__row calendar__row">
  <td class="calendar__cell calendar__date date"><span>Mon<br>Oct 12</span></td>
  <td class="calendar__cell calendar__time time"><span>8:30am</span></td>
  <td class="calendar__cell calendar__currency currency">USD</td>
  <td class="calendar__cell calendar__impact impact impact--high"><span title="High Impact Expected"></span></td>
  <td class="calendar__cell calendar__event event"><span class="calendar__event-title">CPI y/y</span></td>
  <td class="calendar__cell calendar__actual actual"></td>
  <td class="calendar__cell calendar__forecast forecast">3.1%</td>
  <td class="calendar__cell calendar__previous previous">3.0%</td>
</tr>
<tr class="calendar__row calendar__row">
  <td class="calendar__cell calendar__date date"></td>
  <td class="calendar__cell calendar__time time"></td>
  <td class="calendar__cell calendar__currency currency">USD</td>
  <td class="calendar__cell calendar__impact impact impact--medium"><span title="Medium Impact Expected"></span></td>
  <td class="calendar__cell calendar__event event"><span class="calendar__event-title">Core CPI m/m</span></td>
  <td class="calendar__cell calendar__actual actual"></td>
  <td class="calendar__cell calendar__forecast forecast">0.2%</td>
  <td class="calendar__cell calendar__previous previous">0.3%</td>
</tr>
<tr class="calendar__row calendar__row">
  <td class="calendar__cell calendar__date date"><span>Tue<br>Oct 13</span></td>
  <td class="calendar__cell calendar__time time">All Day</td>
  <td class="calendar__cell calendar__currency currency">JPY</td>
  <td class="calendar__cell calendar__impact impact calendar__impact calendar__impact--holiday"></td>
  <td class="calendar__cell calendar__event event"><span class="calendar__event-title">Bank Holiday</span></td>
  <td class="calendar__cell calendar__actual actual"></td>
  <td class="calendar__cell calendar__forecast forecast"></td>
  <td class="calendar__cell calendar__previous previous"></td>
</tr>
</tbody></table>
</body></html>`;

const out = FF.parseMonthHtml(html, new Date('2026-10-08T00:00:00Z'));
assert.strictEqual(out.offsetHours, -5);
assert.strictEqual(out.rows.length, 3);

assert.deepStrictEqual(
  { date: out.rows[0].date, title: out.rows[0].title, country: out.rows[0].country, impact: out.rows[0].impact },
  { date: '2026-10-12', title: 'CPI y/y', country: 'USD', impact: 'High' }
);
assert.strictEqual(out.rows[0].instantIso, '2026-10-12T13:30:00.000Z');
assert.strictEqual(out.rows[0].forecast, '3.1%');
assert.strictEqual(out.rows[0].previous, '3.0%');

assert.strictEqual(out.rows[1].date, '2026-10-12', 'blank date cell must inherit the previous calendar date');
assert.strictEqual(out.rows[1].displayTime, '8:30am', 'blank time cell must inherit the previous event time');
assert.strictEqual(out.rows[1].instantIso, '2026-10-12T13:30:00.000Z');
assert.strictEqual(out.rows[1].impact, 'Medium');

assert.strictEqual(out.rows[2].date, '2026-10-13');
assert.strictEqual(out.rows[2].impact, 'Holiday');
assert.strictEqual(out.rows[2].exactTime, false);
assert.strictEqual(out.rows[2].instantIso, null);
assert.strictEqual(out.rows[2].displayTime, 'All Day');

console.log('Forex Factory monthly HTML parser tests passed');
