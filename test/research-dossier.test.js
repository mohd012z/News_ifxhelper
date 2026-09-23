'use strict';
const assert=require('assert'),R=require('../lib/research-dossier');
const base={eventId:'US-CPI-2026-10',name:'CPI',scheduledAt:'2026-10-14T12:30:00Z',previous:0.2,forecast:0.3,actual:null,revision:null,history:{samples:24},technical:{M30:'TOP_BB',H1:'UP',W1:'UP',MN1:'UP'},context:{dxy:'UP',yields:'UP'},sources:[{name:'official',sourceAt:'2026-09-23T00:00:00Z'}]};
const a=R.build(base,{generatedAt:'2026-09-23T01:00:00Z'});const same=R.build(base,{generatedAt:'2026-09-23T02:00:00Z',previous:a});assert.equal(same.changeState,'SKIPPED_UNCHANGED');assert.equal(same.version,a.version);
const changed=R.build({...base,forecast:0.4},{generatedAt:'2026-09-23T03:00:00Z',previous:a});assert.equal(changed.changeState,'UPDATED');assert.equal(changed.version,a.version+1);assert(changed.changeReasons.includes('FORECAST_CHANGED'));
const speech=R.build({...base,context:{...base.context,speechHash:'abc'}},{generatedAt:'2026-09-23T04:00:00Z',previous:a});assert(speech.changeReasons.includes('CONTEXT_CHANGED'));
console.log('research dossier tests passed');
