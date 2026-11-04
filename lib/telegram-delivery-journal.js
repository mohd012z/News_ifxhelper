'use strict';
/**
 * Append-only, crash-recoverable Telegram delivery receipts.
 * No API credentials, message bodies or personal data are persisted here.
 * A successful API acknowledgement is journaled synchronously before the next send.
 * Telegram has no idempotency key: a crash between remote acceptance and local
 * receipt can still result in a duplicate on retry (at-least-once semantics).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fingerprint(key, destination) {
  if (typeof key !== 'string' || !key || typeof destination !== 'string' || !destination) {
    throw new TypeError('Delivery key and destination are required');
  }
  return crypto.createHash('sha256').update(JSON.stringify([destination, key])).digest('hex');
}

class DeliveryJournal {
  constructor(file, destination, legacyKeys = []) {
    this.file = file;
    if (typeof destination !== 'string' || !destination) throw new TypeError('Delivery destination is required');
    this.destination = destination;
    this.delivered = new Set();
    this.legacy = new Set(legacyKeys);
    this.load();
  }
  load() {
    if (!fs.existsSync(this.file)) return;
    const bytes = fs.readFileSync(this.file, 'utf8');
    const lines = bytes.split('\n');
    // A partially written last line is not an acknowledged receipt.
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].trim()) continue;
      let row;
      try { row = JSON.parse(lines[i]); } catch (err) {
        throw new Error('Corrupt delivery journal at line ' + (i + 1), { cause: err });
      }
      if (row.v !== 1 || row.kind !== 'confirmed' || !/^[a-f0-9]{64}$/.test(row.id)) {
        throw new Error('Invalid delivery journal record at line ' + (i + 1));
      }
      this.delivered.add(row.id);
    }
    if (lines.at(-1)?.trim()) {
      throw new Error('Incomplete delivery journal: refusing to send until repaired');
    }
  }
  has(key) {
    return this.legacy.has(key) || this.delivered.has(fingerprint(key, this.destination));
  }
  confirm(key) {
    if (this.has(key)) return false;
    const id = fingerprint(key, this.destination);
    const line = JSON.stringify({ v: 1, kind: 'confirmed', id, at: new Date().toISOString() }) + '\n';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.file, 'a', 0o600);
    try {
      fs.writeSync(fd, line);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.delivered.add(id);
    return true;
  }
}
module.exports = { DeliveryJournal, fingerprint };
