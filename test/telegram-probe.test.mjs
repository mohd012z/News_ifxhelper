import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('read-only probe dry-run needs no token',()=>{
 const env={...process.env};delete env.TELEGRAM_BOT_TOKEN;
 const r=spawnSync(process.execPath,['telegram/probe-bot.mjs','--dry-run'],{env,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/DRY_RUN/);
});
test('probe fails closed when bot token missing',()=>{
 const env={...process.env};delete env.TELEGRAM_BOT_TOKEN;
 const r=spawnSync(process.execPath,['telegram/probe-bot.mjs'],{env,encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/BLOCKED/);
});
