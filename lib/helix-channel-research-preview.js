'use strict';
/** Read-only Telegram HTML report. Never invokes Telegram API. */
const {analyze}=require('./snd-mtf-research');
const CHANNEL='@ifxhelper2';
const TFS=['H4','H1','M15','M5'];
function esc(x){return String(x??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function format(report,{symbol='XAUUSD'}={}){
 if(!report||report.kind!=='RESEARCH_ONLY'||!report.timeframes||!Number.isFinite(Date.parse(report.asOf)))throw new TypeError('invalid research report');
 const lines=['🔬 <b>HELIX RESEARCH PREVIEW — NOT PUBLISHED</b>','📡 Intended channel: <code>'+CHANNEL+'</code>','📌 Symbol: <b>'+esc(symbol)+'</b>','🕒 As of: <code>'+esc(report.asOf)+'</code>','📊 <b>BBMA + STRUCTURAL S&amp;D</b>'];
 for(const tf of TFS){
  const x=report.timeframes[tf];
  if(!x||x.state!=='READY'){lines.push('• <b>'+tf+'</b>: unavailable / insufficient verified candles');continue;}
  lines.push('• <b>'+tf+'</b> | BBMA: '+esc(x.bbma?.trend??x.bbma?.state)+' | Closed bars: '+esc(x.closedCandles));
  if(!x.zones.length)lines.push('  S&amp;D: no confirmed zones');
  for(const z of x.zones.slice(-3)){
   lines.push('  '+esc(z.type)+' '+esc(z.side)+' ['+esc(z.distal)+' – '+esc(z.proximal)+'] '+esc(z.status));
   lines.push('  Confirmed: '+esc(z.confirmedAt)+' | BBMA: '+esc(z.bbmaAtConfirmation?.state));
  }
 }
 lines.push('🔎 Aligned demand: '+esc(report.summary?.alignedDemand)+' | supply: '+esc(report.summary?.alignedSupply)+' | conflicts: '+esc(report.summary?.conflicts));
 lines.push('⚠️ Descriptive research only. No trading signal, no delivery.');
 return {destination:CHANNEL,mode:'PREVIEW_ONLY',parse_mode:'HTML',text:lines.join('\n')};
}
function preview(frames,options){return format(analyze(frames,{...options,timeframes:TFS}),{symbol:options?.symbol});}
module.exports={format,preview,CHANNEL,TFS};
