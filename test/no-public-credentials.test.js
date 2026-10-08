'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');

const data=fs.readFileSync(path.join(root,'xauusd-data.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const live=fs.readFileSync(path.join(root,'live.js'),'utf8');

assert(!/twelveDataApiKey\s*:\s*["'][^"']+["']/.test(data),'public client data must not embed a Twelve Data API key');
assert(data.includes('No provider API keys embedded in public client assets'),'credential policy marker missing');
assert(!/wss:\/\/ws\.twelvedata\.com\/v1\/quotes\/price\?apikey=[A-Za-z0-9_-]+/.test(data+app+live),'literal Twelve Data websocket credential must not appear in client files');

console.log('public credential regression tests passed');
