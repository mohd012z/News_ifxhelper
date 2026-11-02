'use strict';
// Source adapters accept supplied JSON only. No background scraping or credentials.
const {triageStory}=require('./global-event-triage');
function usgsFeatureToStory(feature) {
 if(!feature||feature.type!=='Feature'||!feature.properties) throw TypeError('Invalid USGS feature');
 const p=feature.properties;
 const magnitude=Number(p.mag);
 if(!Number.isFinite(magnitude)||magnitude<0||magnitude>10) throw Error('Invalid earthquake magnitude');
 const place=String(p.place||'Unknown location').slice(0,180);
 const timestamp=Number(p.time);
 if(!Number.isFinite(timestamp)||timestamp<=0) throw Error('Invalid earthquake timestamp');
 const url=String(p.url||'');
 if(url&&!/^https:\/\/earthquake\.usgs\.gov\//.test(url)) throw Error('Untrusted USGS URL');
 return {provider:'usgs',verified:true,title:`Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,summary:'Seismic event confirmed by USGS; market and infrastructure effects not established',timeUtc:new Date(timestamp).toISOString(),sourceUrl:url,importance:magnitude>=7?'high':magnitude>=5?'medium':'low',infrastructureImpactConfirmed:false,marketReactionVerified:false};
}
function usgsFeedToStories(feed,{minMagnitude=5,maxItems=50}={}) {
 if(!feed||!Array.isArray(feed.features)) throw TypeError('Invalid USGS GeoJSON feed');
 return feed.features.slice(0,Math.max(0,Math.min(100,maxItems))).map(usgsFeatureToStory).filter(s=>Number(s.title.match(/Magnitude (\d+\.\d)/)?.[1])>=minMagnitude);
}
function socialPostToLead(post) {
 if(!post||!['x','twitter','instagram'].includes(String(post.provider||'').toLowerCase())) throw Error('Unsupported social provider');
 const text=String(post.text||'').slice(0,1000);
 if(!text.trim()) throw Error('Empty social post');
 return {...triageStory({provider:post.provider,title:text,verified:false,importance:'medium'}),sourceClass:'social-lead',verification:'unverified',publishableAsConfirmed:false,sourceId:String(post.id||'').slice(0,128)};
}
module.exports={usgsFeatureToStory,usgsFeedToStories,socialPostToLead};
