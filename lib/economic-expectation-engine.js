'use strict';
/** Economic expectation engine.
 * Separates PRE-RELEASE expectation (forecast vs previous) from POST-RELEASE surprise (actual vs forecast).
 * Outputs descriptive macro pressure, never a guaranteed market direction.
 */
function num(v){if(v==null||v==='')return null;const m=String(v).replace(/,/g,'').match(/[-+]?\d*\.?\d+/);return m?+m[0]:null;}
const FAMILIES=[
 {id:'INFLATION',re:/\b(cpi|pce|ppi|inflation|consumer price|producer price)\b/i,betterHigh:1,policyHigh:1},
 {id:'EMPLOYMENT',re:/\b(nonfarm|payroll|employment change|jobs added|average hourly earnings|wage)\b/i,betterHigh:1,policyHigh:1},
 {id:'UNEMPLOYMENT',re:/\b(unemployment rate|jobless rate)\b/i,betterHigh:-1,policyHigh:-1},
 {id:'CLAIMS',re:/\b(initial claims|continuing claims|jobless claims|unemployment claims)\b/i,betterHigh:-1,policyHigh:-1},
 {id:'GROWTH',re:/\b(gdp|retail sales|industrial production|pmi|ism)\b/i,betterHigh:1,policyHigh:1},
 {id:'RATES',re:/\b(interest rate|policy rate|cash rate|fed funds|bank rate)\b/i,betterHigh:0,policyHigh:1}
];
function family(name){return FAMILIES.find(x=>x.re.test(name||''))||{id:'UNMAPPED',betterHigh:0,policyHigh:0};}
function cmp(a,b){return a==null||b==null?null:a>b?1:a<b?-1:0;}
function strength(delta,base){if(delta==null)return 'UNKNOWN';const d=Math.abs(delta),den=Math.max(Math.abs(base||0),1e-9),r=d/den;if(d===0)return 'FLAT';return r>=.10?'STRONG':r>=.03?'MODERATE':'MILD';}
function analyze(e){
 const name=e.event||e.title||'',f=family(name),actual=num(e.actual),forecast=num(e.forecast),previous=num(e.previous),revisedPrevious=num(e.revisedPrevious);
 const prior=revisedPrevious==null?previous:revisedPrevious;
 const expectedDelta=forecast==null||prior==null?null:forecast-prior;
 const expectedCmp=cmp(forecast,prior), surpriseDelta=actual==null||forecast==null?null:actual-forecast, surpriseCmp=cmp(actual,forecast), trendCmp=cmp(actual,prior);
 const preDirection=expectedCmp==null||!f.betterHigh?'UNKNOWN':expectedCmp*f.betterHigh>0?'STRONGER':expectedCmp*f.betterHigh<0?'WEAKER':'UNCHANGED';
 const surpriseDirection=surpriseCmp==null||!f.betterHigh?'UNKNOWN':surpriseCmp*f.betterHigh>0?'STRONGER_THAN_EXPECTED':surpriseCmp*f.betterHigh<0?'WEAKER_THAN_EXPECTED':'IN_LINE';
 return {family:f.id,actual,forecast,previous,revisedPrevious,prior,preRelease:{direction:preDirection,delta:expectedDelta,strength:strength(expectedDelta,prior),meaning:'Forecast vs prior describes consensus trend, not the release outcome.'},postRelease:{direction:surpriseDirection,delta:surpriseDelta,strength:strength(surpriseDelta,forecast),actualVsPrior:trendCmp},flags:{hasActual:actual!=null,hasForecast:forecast!=null,hasPrior:prior!=null,revisionApplied:revisedPrevious!=null}};
}
module.exports={num,FAMILIES,family,analyze};
