'use strict';
function ageMin(now,time){const n=new Date(now).getTime(),t=new Date(time).getTime();return Number.isFinite(n)&&Number.isFinite(t)?Math.max(0,(n-t)/60000):null;}
function run(x={}){const now=x.now||new Date().toISOString(),checks=[];const add=(level,code,detail)=>checks.push({level,code,detail});
 const marketAge=x.current&&x.current.sourceAt?ageMin(now,x.current.sourceAt):null;if(marketAge==null)add('FAIL','MARKET_MISSING');else if(marketAge>30)add('FAIL','MARKET_STALE',{ageMin:marketAge});
 for(const tf of ['W1','MN1']){const f=x.current&&x.current.frames&&x.current.frames[tf];if(f&&f.complete===false)add('FAIL',`${tf}_INCOMPLETE`);}
 if(!x.learning||!x.learning.sourceAt)add('FAIL','LEARNING_MISSING');else if(ageMin(now,x.learning.sourceAt)>1440)add('WARN','LEARNING_STALE');
 if(!x.research||!x.research.generatedAt)add('WARN','RESEARCH_MISSING');else if(ageMin(now,x.research.generatedAt)>1440)add('WARN','RESEARCH_STALE',{ageMin:ageMin(now,x.research.generatedAt),version:x.research.version||null});
 if(!x.health||!x.health.sourceAt)add('WARN','HEALTH_MISSING');
 const status=checks.some(c=>c.level==='FAIL')?'FAIL':checks.some(c=>c.level==='WARN')?'WARN':'PASS';return {status,checkedAt:now,checks};}
module.exports={ageMin,run};
