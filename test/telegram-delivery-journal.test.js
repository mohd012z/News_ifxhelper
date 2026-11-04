'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeliveryJournal, fingerprint } = require('../lib/telegram-delivery-journal');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifx-journal-'));
const file = path.join(dir, 'receipts.jsonl');
try {
  const a = new DeliveryJournal(file, 'chat-1', ['legacy']);
  assert.equal(a.has('legacy'), true, 'legacy sentKeys remain honored');
  assert.equal(a.has('new'), false);
  assert.equal(a.confirm('new'), true);
  assert.equal(a.confirm('new'), false, 'duplicate receipt is suppressed');
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
  const restarted = new DeliveryJournal(file, 'chat-1');
  assert.equal(restarted.has('new'), true, 'restart recovers confirmed receipt');
  assert.equal(new DeliveryJournal(file, 'chat-2').has('new'), false, 'different destination is distinct');
  assert.notEqual(fingerprint('key', 'a'), fingerprint('key', 'b'));
  fs.appendFileSync(file, '{"v":1,"kind":"confirmed"', 'utf8');
  assert.throws(() => new DeliveryJournal(file, 'chat-1'), /Incomplete delivery journal/);
  fs.writeFileSync(file, '{"v":1,"kind":"confirmed","id":"bad"}\n');
  assert.throws(() => new DeliveryJournal(file, 'chat-1'), /Invalid delivery journal/);
  assert.throws(() => new DeliveryJournal(file, ''), /Invalid delivery journal/);
  console.log('Telegram delivery journal restart and dedup tests passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
