'use strict';
const assert=require('assert'),F=require('../lib/source-fallback');
const now='2026-09-23T09:30:00Z';
const sources=[
 {name:'primary',priority:1,sourceAt:'2026-09-23T08:00:00Z',ok:true,data:{price:1}},
 {name:'fallback',priority:2,sourceAt:'2026-09-23T09:29:00Z',ok:true,data:{price:2}}
];
const a=F.select(sources,{now,maxAgeMin:5});assert.equal(a.state,'FALLBACK');assert.equal(a.selected.name,'fallback');assert.equal(a.selected.data.price,2);
const b=F.select([{name:'primary',priority:1,sourceAt:'2026-09-23T09:29:30Z',ok:true,data:{price:3}},...sources.slice(1)],{now,maxAgeMin:5});assert.equal(b.state,'PRIMARY');assert.equal(b.selected.name,'primary');
const c=F.select([{name:'primary',priority:1,sourceAt:'2026-09-23T08:00:00Z',ok:true},{name:'fallback',priority:2,sourceAt:'2026-09-23T08:30:00Z',ok:false}],{now,maxAgeMin:5});assert.equal(c.state,'OFFLINE');assert.equal(c.selected,null);
const rec=F.recovery({previousSource:'fallback',currentSource:'primary'});assert.equal(rec,'RECOVERED_PRIMARY');
console.log('source fallback tests passed');
