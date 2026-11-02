'use strict';
const {eligibleMemory,decisionBrief}=require('./cloudflare-agent-skills');
function summarizeResearch(records) {
 const verified=Array.isArray(records)?records.filter(eligibleMemory):[];
 const brief=decisionBrief(verified);
 return {
  ...brief,
  facts:verified.slice(0,20).map(r=>({skill:r.skill,summary:r.summary,sourceUrl:r.sourceUrl,eventKey:r.eventKey||null})),
  contradictions:[],
  limitations:['Source URLs are not independently fetched by this module','No historical prediction calibration is available','Human review required before publishing'],
  generatedFromConfirmedRecords:verified.length
 };
}
module.exports={summarizeResearch};
