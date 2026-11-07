// D1 persistence for validated, completed OHLC candles and timestamped spreads.
// This module never performs trades, publishes Telegram messages or deploys infrastructure.
import {candlesToCSV,candlesFromCSV} from './helix-ohlc-csv.mjs';
export const MARKET_SCHEMA=`CREATE TABLE IF NOT EXISTS helix_ohlc (
 provider TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
 open_time INTEGER NOT NULL, close_time INTEGER NOT NULL,
 open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
 ingested_at INTEGER NOT NULL,
 PRIMARY KEY(provider,symbol,timeframe,open_time)
);
CREATE INDEX IF NOT EXISTS helix_ohlc_lookup ON helix_ohlc(provider,symbol,timeframe,open_time DESC);
CREATE TABLE IF NOT EXISTS helix_spread (
 provider TEXT NOT NULL, symbol TEXT NOT NULL, observed_at INTEGER NOT NULL,
 bid REAL NOT NULL, ask REAL NOT NULL, spread_price REAL NOT NULL,
 PRIMARY KEY(provider,symbol,observed_at)
);`;
const IDENT=/^[A-Za-z0-9_.-]{1,48}$/;
export async function ingestCandles(db,candles,{now=Date.now()}={}){
 if(!db?.prepare)throw Error('Missing D1 binding');
 // Use CSV roundtrip as the canonical fail-closed validation boundary.
 const validated=candlesFromCSV(candlesToCSV(candles,{now}),{now});
 if(validated.length>1000)throw Error('Batch exceeds D1 ingestion limit');
 let inserted=0,duplicates=0;
 for(const b of validated){
  const r=await db.prepare('INSERT OR IGNORE INTO helix_ohlc(provider,symbol,timeframe,open_time,close_time,open,high,low,close,ingested_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(b.provider,b.symbol,b.timeframe,b.openTime,b.closeTime,b.open,b.high,b.low,b.close,now).run();
  if(r.meta?.changes===1)inserted++;else duplicates++;
 }
 return {inserted,duplicates};
}
export async function readCandles(db,{provider,symbol,timeframe,limit=500}={}){
 if(!db?.prepare||![provider,symbol,timeframe].every(v=>typeof v==='string'&&IDENT.test(v))||!Number.isInteger(limit)||limit<1||limit>5000)throw Error('Invalid OHLC query');
 const r=await db.prepare('SELECT provider,symbol,timeframe,open_time,close_time,open,high,low,close FROM helix_ohlc WHERE provider=? AND symbol=? AND timeframe=? ORDER BY open_time DESC LIMIT ?').bind(provider,symbol,timeframe,limit).all();
 return (r.results||[]).map(x=>({provider:x.provider,symbol:x.symbol,timeframe:x.timeframe,openTime:x.open_time,closeTime:x.close_time,open:x.open,high:x.high,low:x.low,close:x.close})).reverse();
}
export async function exportCandlesCSV(db,query,{now=Date.now()}={}){return candlesToCSV(await readCandles(db,query),{now});}
export async function ingestSpread(db,{provider,symbol,observedAt,bid,ask},{now=Date.now()}={}){
 if(!db?.prepare||![provider,symbol].every(v=>typeof v==='string'&&IDENT.test(v))||!Number.isSafeInteger(observedAt)||observedAt>now||observedAt<0||![bid,ask].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||ask<bid)throw Error('Invalid spread observation');
 const r=await db.prepare('INSERT OR IGNORE INTO helix_spread(provider,symbol,observed_at,bid,ask,spread_price) VALUES(?,?,?,?,?,?)').bind(provider,symbol,observedAt,bid,ask,ask-bid).run();
 return {inserted:r.meta?.changes===1};
}
