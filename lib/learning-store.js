'use strict';
const L=require('./bbma-learning');
const MINUTES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440,W1:10080,MN1:43200};
function upsertObservation(rows,obs){const i=rows.findIndex(x=>x.id===obs.id);if(i<0){rows.push(obs);return {inserted:true,row:obs};}return {inserted:false,row:rows[i]};}
function exactNextCandle(obs,frames){const mins=MINUTES[obs.tf];if(!mins)return null;const target=new Date(new Date(obs.candleTime).getTime()+mins*60000).toISOString();return (frames[obs.tf]||[]).find(c=>new Date(c.time).toISOString()===target)||null;}
function settleDue(rows,frames){return rows.map(r=>{if(r.status==='SETTLED')return r;const c=exactNextCandle(r,frames);return c?L.settle(r,c):r;});}
function performance(rows){const report=L.report(rows);return {...report,generatedAt:new Date().toISOString(),pending:rows.filter(x=>x.status==='PENDING').length,settled:rows.filter(x=>x.status==='SETTLED').length};}
module.exports={MINUTES,upsertObservation,exactNextCandle,settleDue,performance};
