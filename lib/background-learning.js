'use strict';
const MINUTES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440,W1:10080};
function exactOutcomeTime(obs){const n=MINUTES[obs.timeframe];if(!n)throw new Error('Unsupported settlement timeframe: '+obs.timeframe);const t=new Date(obs.predictionTime).getTime();if(!Number.isFinite(t))throw new Error('Invalid predictionTime');return new Date(t+n*60000).toISOString();}
function due(rows,now){const n=new Date(now).getTime();return (rows||[]).filter(x=>x.status==='PENDING'&&new Date(exactOutcomeTime(x)).getTime()<=n);}
function settle(obs,candles,settledAt=new Date().toISOString()){if(obs.status!=='PENDING')return obs;const target=exactOutcomeTime(obs),bar=(candles||[]).find(x=>new Date(x.time).getTime()===new Date(target).getTime());if(!bar)return {...obs,reason:'EXACT_OUTCOME_MISSING',lastCheckedAt:settledAt};const delta=Number.isFinite(+bar.close)&&Number.isFinite(+bar.open)?+bar.close-+bar.open:null;return {...obs,status:'SETTLED',outcomeTime:target,settledAt,outcome:{open:+bar.open,close:+bar.close,delta,direction:delta>0?'UP':delta<0?'DOWN':'FLAT'},reason:null};}
module.exports={MINUTES,exactOutcomeTime,due,settle};
