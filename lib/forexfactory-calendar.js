'use strict';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function textOf(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cellHtml(row, field) {
  const re = new RegExp('<td\\b[^>]*class=["\\\'][^"\\\']*calendar__' + field + '\\b[^"\\\']*["\\\'][^>]*>([\\s\\S]*?)<\\/td>', 'i');
  const m = re.exec(row);
  return m ? m[1] : '';
}

function eventTitle(row) {
  const ev = cellHtml(row, 'event');
  const m = /<(?:span|a)\b[^>]*class=["'][^"']*calendar__event-title[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|a)>/i.exec(ev);
  return textOf(m ? m[1] : ev);
}

function pageGmtOffsetHours(html) {
  const plain = textOf(html);
  const m = /Calendar Time Zone:\s*[^()]{0,100}\(\s*GMT\s*([+-]?\d+(?:\.\d+)?)\s*\)/i.exec(plain);
  return m ? Number(m[1]) : null;
}

function parseCalendarDate(text, now) {
  const m = /\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*([A-Z][a-z]{2})\s+(\d{1,2})\b/.exec(String(text || ''));
  if (!m || MONTHS[m[1]] == null) return null;
  const month = MONTHS[m[1]], day = Number(m[2]);
  let year = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth();
  if (month < nowMonth - 6) year += 1;
  else if (month > nowMonth + 6) year -= 1;
  return { year, month, day, iso: year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0') };
}

function parseClockInstant(date, timeText, offsetHours) {
  if (!date || !Number.isFinite(offsetHours)) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(timeText || '').trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') hour += 12;
  const minute = Number(m[2]);
  const localAsUtc = Date.UTC(date.year, date.month, date.day, hour, minute);
  return new Date(localAsUtc - offsetHours * 3600000);
}

function impactFromRow(row, title) {
  const cls = /(?:calendar__)?impact--(high|medium|low|holiday)/i.exec(row);
  if (cls) return cls[1][0].toUpperCase() + cls[1].slice(1).toLowerCase();
  const ttl = /title=["']\s*(High|Medium|Low)\s+Impact Expected\s*["']/i.exec(row);
  if (ttl) return ttl[1][0].toUpperCase() + ttl[1].slice(1).toLowerCase();
  if (/\bholiday\b/i.test(title)) return 'Holiday';
  return 'Low';
}

function parseMonthHtml(html, now = new Date()) {
  const offsetHours = pageGmtOffsetHours(html);
  const rows = [];
  const rowRe = /<tr\b[^>]*class=["'][^"']*calendar__row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = null, currentTime = '', m;
  while ((m = rowRe.exec(String(html || '')))) {
    const row = m[0];
    const dateText = textOf(cellHtml(row, 'date'));
    if (dateText) currentDate = parseCalendarDate(dateText, now);
    if (!currentDate) continue;

    const timeText = textOf(cellHtml(row, 'time'));
    if (timeText) currentTime = timeText;
    const title = eventTitle(row);
    if (!title) continue;

    const country = textOf(cellHtml(row, 'currency')) || null;
    const exactInstant = parseClockInstant(currentDate, currentTime, offsetHours);
    rows.push({
      date: currentDate.iso,
      title,
      country,
      impact: impactFromRow(row, title),
      actual: textOf(cellHtml(row, 'actual')) || null,
      forecast: textOf(cellHtml(row, 'forecast')) || null,
      previous: textOf(cellHtml(row, 'previous')) || null,
      displayTime: currentTime || null,
      exactTime: !!exactInstant,
      instantIso: exactInstant ? exactInstant.toISOString() : null,
      pageGmtOffsetHours: offsetHours
    });
  }
  return { offsetHours, rows };
}

module.exports = { decodeEntities, textOf, pageGmtOffsetHours, parseCalendarDate, parseClockInstant, parseMonthHtml };
