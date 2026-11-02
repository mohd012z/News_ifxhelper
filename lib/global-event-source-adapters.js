'use strict';
// Source adapters accept supplied JSON only. No background scraping or credentials.
const {triageStory}=require('./global-event-triage');
function usgsFeatureToStory(feature) {
 if(!feature||feature.type!=='Feature'||!feature.properties) throw TypeError('Invalid USGS feature');
 const p=feature.properties;
 if(p.mag===null||p.mag===undefined||p.mag==='') throw Error('Invalid earthquake magnitude');
 const magnitude=Number(p.mag);
 if(!Number.isFinite(magnitude)||magnitude<0||magnitude>10) throw Error('Invalid earthquake magnitude');
 const place=String(p.place||'Unknown location').slice(0,180);
 if(p.time===null||p.time===undefined||p.time==='') throw Error('Invalid earthquake timestamp');
 const timestamp=Number(p.time);
 if(!Number.isFinite(timestamp)||timestamp<=0||timestamp>8640000000000000) throw Error('Invalid earthquake timestamp');
 const url=String(p.url||'');
 if(url&&!/^https:\/\/earthquake\.usgs\.gov\//.test(url)) throw Error('Untrusted USGS URL');
 return {provider:'usgs',verified:true,title:`Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,summary:'Seismic event confirmed by USGS; market and infrastructure effects not established',timeUtc:new Date(timestamp).toISOString(),sourceUrl:url,importance:magnitude>=7?'high':magnitude>=5?'medium':'low',infrastructureImpactConfirmed:false,marketReactionVerified:false};
}
function usgsFeedToStories(feed,{minMagnitude=5,maxItems=50}={}) {
 if(!feed||!Array.isArray(feed.features)) throw TypeError('Invalid USGS GeoJSON feed');
 if(!Number.isFinite(minMagnitude)||minMagnitude<0||minMagnitude>10) throw Error('Invalid minimum magnitude');
 if(!Number.isInteger(maxItems)||maxItems<0||maxItems>100) throw Error('Invalid item limit');
 return feed.features.map(usgsFeatureToStory).filter(s=>Number(s.title.match(/Magnitude (\d+\.\d)/)?.[1])>=minMagnitude).slice(0,maxItems);
}
function socialPostToLead(post) {
 if(!post||!['x','twitter','instagram'].includes(String(post.provider||'').toLowerCase())) throw Error('Unsupported social provider');
 const text=String(post.text||'').slice(0,1000);
 if(!text.trim()) throw Error('Empty social post');
 return {...triageStory({provider:post.provider,title:text,verified:false,importance:'medium'}),sourceClass:'social-lead',verification:'unverified',publishableAsConfirmed:false,sourceId:String(post.id||'').slice(0,128)};
}
module.exports={usgsFeatureToStory,usgsFeedToStories,socialPostToLead};
