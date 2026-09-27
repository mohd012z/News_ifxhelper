'use strict';
function num(v){if(v==null||v==='')return null;const m=String(v).replace(/,/g,'').match(/[-+]?\d*\.?\d+/);return m?+m[0]:null;}
const RULES=[
 {id:'INFLATION',re:/\b(cpi|pce|inflation|consumer price|producer price|ppi)\b/i,sign:1},
 {id:'LABOR_STRENGTH',re:/\b(nonfarm|payroll|employment change|jobs added|wage|earnings)\b/i,sign:1},
 {id:'UNEMPLOYMENT',re:/\b(unemployment rate|jobless rate)\b/i,sign:-1},
 {id:'CLAIMS',re:/\b(jobless claims|unemployment claims|initial claims|continuing claims)\b/i,sign:-1},
 {id:'GROWTH',re:/\b(gdp|retail sales|pmi|ism|industrial production)\b/i,sign:1}
];
function evaluate(e){
 const actual=num(e.actual),forecast=num(e.forecast),previous=num(e.previous),name=e.event||e.title||'';
 const rule=RULES.find(r=>r.re.test(name));
 if(actual==null||forecast==null)return {state:'PENDING',ruleId:rule?rule.id:'UNMAPPED',actual,forecast,previous,surprise:null,macroDirection:'NEUTRAL',confidence:0};
 const surprise=actual-forecast;
 if(!rule)return {state:'UNMAPPED',ruleId:'UNMAPPED',actual,forecast,previous,surprise,macroDirection:'NEUTRAL',confidence:0};
 const signed=surprise*rule.sign;
 return {state:surprise===0?'INLINE':'RELEASED',ruleId:rule.id,actual,forecast,previous,surprise:+surprise.toFixed(6),macroDirection:signed>0?'UP':signed<0?'DOWN':'NEUTRAL',confidence:surprise===0?35:70};
}
module.exports={num,evaluate,RULES};
