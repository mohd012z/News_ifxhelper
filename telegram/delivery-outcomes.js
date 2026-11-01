'use strict';
// Classification of API transport evidence for read-only Telegram notifications.
function classifyTelegramOutcome(status,apiOk,networkFailure=false){
 if(networkFailure||!Number.isInteger(status)||status>=500)return{ok:false,uncertain:true};
 if(status===429)return{ok:false,rateLimited:true};
 if(status>=200&&status<300)return apiOk===true?{ok:true}:{ok:false,uncertain:true};
 return{ok:false};
}
module.exports={classifyTelegramOutcome};
