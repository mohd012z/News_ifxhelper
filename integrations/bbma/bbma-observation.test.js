'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeBBMAObservation } = require('./bbma-observation');
const sample = {symbol:'XAUUSD',timeframe:'H1',pattern:'REENTRY',side:'BUY',closedAt:'2026-01-01T01:00:00Z',confirmed:true};
test('normalizes confirmed research observation',()=>{const o=normalizeBBMAObservation(sample,Date.parse('2026-01-02'));assert.equal(o.executionAllowed,false);assert.equal(o.schema,'bbma.research.v1');});
test('rejects provisional signal',()=>assert.throws(()=>normalizeBBMAObservation({...sample,confirmed:false},Date.parse('2026-01-02'))));
test('rejects future timestamp',()=>assert.throws(()=>normalizeBBMAObservation(sample,Date.parse('2025-01-01'))));
test('rejects invalid pattern',()=>assert.throws(()=>normalizeBBMAObservation({...sample,pattern:'TRADE_NOW'},Date.parse('2026-01-02'))));
