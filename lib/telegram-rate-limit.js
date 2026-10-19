'use strict';

function retryAfterSeconds(response) {
  const seconds = Number(response && response.parameters && response.parameters.retry_after);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const match = /retry after\s+(\d+)/i.exec((response && response.description) || '');
  return match ? Number(match[1]) : null;
}

async function sendWithRateLimitRetry(send, wait, onRetry = () => {}, maxRetries = 5) {
  let result = await send();
  let retries = 0;
  while (result && result.rateLimited && retries < maxRetries) {
    retries++;
    const seconds = Number(result.retryAfterSeconds);
    const delayMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000 + 1000;
    onRetry({ attempt: retries, delayMs });
    await wait(delayMs);
    result = await send();
  }
  return result;
}

module.exports = { retryAfterSeconds, sendWithRateLimitRetry };
