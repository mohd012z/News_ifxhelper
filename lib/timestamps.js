'use strict';
/**
 * Timestamp helpers for durable event/reaction history.
 * Canonical storage is UTC ISO-8601; MYT is display metadata only.
 */
const MYT_OFFSET_MINUTES=480;
function iso(v){const d=new Date(v==null?Date.now():v);if(!Number.isFinite(d.getTime()))throw new Error('invalid timestamp');return d.toISOString();}
function myt(v){const d=new Date(v==null?Date.now():v);if(!Number.isFinite(d.getTime()))throw new Error('invalid timestamp');const x=new Date(d.getTime()+MYT_OFFSET_MINUTES*60000);return x.toISOString().replace('Z','+08:00');}
function weekKey(v){
 const d=new Date(iso(v)); d.setUTCHours(0,0,0,0);
 const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day);
 const y=new Date(Date.UTC(d.getUTCFullYear(),0,1));
 const w=Math.ceil((((d-y)/86400000)+1)/7);
 return d.getUTCFullYear()+'-W'+String(w).padStart(2,'0');
}
function monthKey(v){const d=new Date(iso(v));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
function stamp(v){
 const utc=iso(v);
 return {utc,myt:myt(v),epochMs:new Date(utc).getTime(),weekUtc:weekKey(v),monthUtc:monthKey(v)};
}
module.exports={iso,myt,weekKey,monthKey,stamp,MYT_OFFSET_MINUTES};
