'use strict';

const assert = require('assert');
const { retryAfterSeconds, sendWithRateLimitRetry } = require('../lib/telegram-rate-limit');

async function run() {
  assert.strictEqual(retryAfterSeconds({ parameters: { retry_after: 22 } }), 22);
  assert.strictEqual(retryAfterSeconds({ description: 'Too Many Requests: retry after 8' }), 8);
  assert.strictEqual(retryAfterSeconds({ description: 'Bad Request' }), null);

  let sends = 0;
  const waits = [];
  const retries = [];
  const result = await sendWithRateLimitRetry(
    async () => {
      sends++;
      return sends === 1
        ? { ok: false, rateLimited: true, retryAfterSeconds: 22 }
        : { ok: true };
    },
    async delayMs => waits.push(delayMs),
    info => retries.push(info)
  );
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(sends, 2);
  assert.deepStrictEqual(waits, [23000]);
  assert.deepStrictEqual(retries, [{ attempt: 1, delayMs: 23000 }]);

  sends = 0;
  const exhausted = await sendWithRateLimitRetry(
    async () => {
      sends++;
      return { ok: false, rateLimited: true, retryAfterSeconds: 1 };
    },
    async () => {},
    () => {},
    2
  );
  assert.strictEqual(exhausted.rateLimited, true);
  assert.strictEqual(sends, 3);

  console.log('Telegram rate-limit tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
