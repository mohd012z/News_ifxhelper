'use strict';
const fs = require('fs');
const path = require('path');
const { collectEventData } = require('./lib/event-data-fabric');

(async () => {
  const data = await collectEventData({
    coinMarketCal: {
      apiKey: process.env.COINMARKETCAL_API_KEY || '',
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    }
  });
  const out = path.join(__dirname, 'events-auto.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`events: ${data.events.length}; health=${JSON.stringify(data.health)}`);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
