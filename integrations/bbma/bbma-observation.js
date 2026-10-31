'use strict';

/**
 * BBMA research observation contract v1.
 * Pure adapter: no network, Telegram, orders, or side effects.
 */
const ALLOWED = new Set(['REENTRY','EXTREME','MAGIC_EXTREME','CSM','CSAK','MHV']);
const SIDES = new Set(['BUY','SELL']);
const TIMEFRAMES = new Set(['M1','M5','M15','M30','H1','H4','D1','W1','MN1']);

function normalizeBBMAObservation(input, nowMs = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('observation must be an object');
  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  const pattern = String(input.pattern ?? '').trim().toUpperCase();
  const side = String(input.side ?? '').trim().toUpperCase();
  const timeframe = String(input.timeframe ?? '').trim().toUpperCase();
  const closedAt = Date.parse(input.closedAt ?? '');
  if (!/^[A-Z0-9._-]{2,32}$/.test(symbol)) throw new Error('invalid symbol');
  if (!ALLOWED.has(pattern)) throw new Error('unsupported pattern');
  if (!SIDES.has(side)) throw new Error('invalid direction');
  if (!TIMEFRAMES.has(timeframe)) throw new Error('invalid timeframe');
  if (!Number.isFinite(closedAt) || closedAt > nowMs) throw new Error('candle must be closed and not future-dated');
  if (input.confirmed !== true) throw new Error('only explicitly confirmed observations accepted');
  const id = [symbol,timeframe,pattern,side,new Date(closedAt).toISOString()].join(':');
  return Object.freeze({
    schema: 'bbma.research.v1', id, symbol, timeframe, pattern, side,
    closedAt: new Date(closedAt).toISOString(),
    confirmed: true, source: 'bbma-research',
    executionAllowed: false
  });
}
module.exports = { normalizeBBMAObservation };
