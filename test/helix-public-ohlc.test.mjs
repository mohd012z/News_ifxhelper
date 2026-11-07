import assert from 'node:assert/strict';
import {normalizeProviderBars,fetchKrakenBTC} from '../worker/helix-public-ohlc.mjs';
const now=Date.parse('2026-11-07T12:00:00Z'),t=Math.floor((now-120000)/1000);
const rows=[[t,'100','103','99','101'],[t+90,'101','105','100','102']];
const fetchImpl=async()=>({ok:true,json:async()=>({error:[],result:{XXBTZUSD:rows,last:t}})});
const candles=await fetchKrakenBTC({now,fetchImpl});
assert.equal(candles.length,1);
assert.equal(candles[0].close,101);
assert.equal(candles[0].provider,'kraken');
// A candle closing exactly at now is complete; one closing later is excluded.
const boundary=normalizeProviderBars([{time:now-60000,open:100,high:103,low:99,close:101},{time:now-59999,open:101,high:104,low:100,close:102}],{provider:'kraken',symbol:'BTCUSD',timeframe:'M1',now});
assert.equal(boundary.length,1);
assert.equal(boundary[0].closeTime,now);
assert.equal(normalizeProviderBars([{time:t,open:100,high:90,low:95,close:98}],{provider:'kraken',symbol:'BTCUSD',timeframe:'M1',now}).length,0);
await assert.rejects(()=>fetchKrakenBTC({interval:2,now,fetchImpl}),/Unsupported/);
await assert.rejects(()=>fetchKrakenBTC({now,fetchImpl:async()=>({ok:true,json:async()=>({error:['failure']})})}),/upstream error/);
console.log('HELIX public OHLC adapter tests passed');
