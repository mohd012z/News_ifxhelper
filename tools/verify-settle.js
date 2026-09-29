'use strict';
const l=require('/opt/data/cache/scratch/News_ifxhelper/data/bbma-learning.json');
const r=l.find(x=>x.predictionId&&x.tf==='M15'&&x.candleTime==='2026-09-28T22:00:00.000Z');
console.log('obs for 22:00 candle:', r?(r.status+' | predicted '+(r.predictedDirection||r.state)+' | actual '+(r.actualDirection||'?')+' | '+(r.correct===null?'inconclusive':(r.correct?'CONFIRMED':'FALSIFIED'))+' | return '+r.nextReturnPct+'%'):'NOT FOUND');
const fs=require('fs');
const f='/opt/data/cache/scratch/News_ifxhelper/data/history/2026/09/outcome.jsonl';
if(fs.existsSync(f)){
  const lines=fs.readFileSync(f,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  console.log('outcome ledger rows:',lines.length);
  lines.slice(-2).forEach(o=>console.log('  OUTCOME:',o.predictionId.slice(0,20),'|',o.verdict,'| actual',o.actualDirection,'| ret',o.returnPct,'| model',o.model+'@'+o.modelVersion,'| snapshot',(o.snapshotId||'').slice(0,12)));
} else console.log('outcome ledger: not yet (settlement pending)');
