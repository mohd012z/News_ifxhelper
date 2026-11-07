'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function extract(name) {
  const start = app.indexOf('  function '+name+'(');
  assert(start >= 0, name+' missing');
  const next = app.indexOf('\n  function ',start+3);
  return app.slice(start,next < 0 ? undefined : next);
}
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="calendar-source-status"></div><div id="incoming-list"></div><div id="alerts-today"></div><div id="alerts-week"></div><div id="alerts-month"></div>');
    const code = [
      'var NEWS_MAX_AGE_MS=6*3600000, EVENT_ALERT_EXPIRY_MS=30*60000;',
      'var liveCalendarStatus={state:"unavailable",fetchedAt:null,error:"offline"};',
      'var windowNews=window.NEWS_AUTO={generatedAt:"2026-11-06T00:00:00Z",calendarAll:[],incoming:[],calendarHorizon:{}};',
      'var D={incoming:[]}, settings={showAuto:true}, incomingView="upcoming", activeId="xau", T={label:"Gold"};',
      'var lastAnnouncedAlerts="",lastAnnouncedNext="", announcements=[];',
      'function $(s){return document.querySelector(s)}',
      'function esc(x){return String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;")}',
      'function fireAlert(a,b){announcements.push([a,b])}',
      'function parseEventTime(x){return x ? new Date(x) : null}',
      'function fullCalendarRows(){return window.NEWS_AUTO.calendarAll}',
      'function filterCalendarView(items){return items}',
      'function calendarSortMs(it){return it.t?it.t.getTime():Infinity}',
      'function calendarDayLabel(){return "Friday"}',
      'function countdownText(){return "soon"}',
      'function impactBadgeClass(){return "b-high"}',
      'function mytDisplay(x){return x||""}',
      'function mytCalendarKey(){return "2026-11-06"}',
      'function renderAll(){}',
      extract('newsSnapshotStatus'),extract('eventAlertEligible'),
      extract('renderIncoming')
    ].join('\n');
    await page.addScriptTag({content:code});
    const result=await page.evaluate(()=>{
      window.NEWS_AUTO.calendarAll=[{event:'OLD',timeGmt:'2026-11-06T00:00:00Z',importance:'high',sourceHorizon:'this-week'}];
      renderIncoming();
      const historical=document.querySelector('#incoming-list').textContent.includes('HISTORICAL / UNVERIFIED');
      const status=document.querySelector('#calendar-source-status').textContent;
      const alertCount=announcements.length;
      window.NEWS_AUTO.generatedAt='bad';
      renderIncoming();
      return {historical,status,alertCount,unverified:document.querySelector('#calendar-source-status').textContent.includes('UNVERIFIED')};
    });
    assert(result.historical,'historical label must appear in rendered DOM');
    assert.match(result.status,/calendar unavailable/);
    assert.equal(result.alertCount,0,'unavailable feed must not announce next event');
    assert(result.unverified,'invalid generatedAt must be visibly unverified');
    console.log('PASS Chromium DOM historical labels, unverified generation and unavailable-source alert suppression');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
