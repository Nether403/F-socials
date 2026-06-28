// In-memory rate limiter: allows up to `limit`, blocks after, tracks remaining,
// and isolates keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRateLimiter } from '../src/infra/memory';

test('allows up to the limit then blocks', async () => {
  const rl = new InMemoryRateLimiter(3);
  const r1 = await rl.hit('ip-a');
  const r2 = await rl.hit('ip-a');
  const r3 = await rl.hit('ip-a');
  const r4 = await rl.hit('ip-a');
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
});

test('separate keys have separate budgets', async () => {
  const rl = new InMemoryRateLimiter(1);
  assert.equal((await rl.hit('ip-a')).allowed, true);
  assert.equal((await rl.hit('ip-a')).allowed, false);
  assert.equal((await rl.hit('ip-b')).allowed, true); // different IP unaffected
});

test('window expiry resets the budget', async () => {
  const rl = new InMemoryRateLimiter(1, 20); // 20ms window
  assert.equal((await rl.hit('ip')).allowed, true);
  assert.equal((await rl.hit('ip')).allowed, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await rl.hit('ip')).allowed, true); // reset
});

// End-to-end: exceeding the per-key daily limit on NEW analyses (cache misses)
// returns HTTP 429. Validates: Requirements 5.6
import express from 'express';
import type { AddressInfo } from 'node:net';
import { optionalAuth } from '../src/http/auth';
import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRepository } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';

test('POST /api/v1/analyses returns 429 once the daily new-analysis limit is exceeded', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(2); // small limit so we can blow past it

  const app = express()
    .use(express.json())
    .use('/api/v1', optionalAuth, makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));

  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/v1/analyses`;

    const submit = (transcript: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Each transcript is unique -> distinct hash -> cache miss -> counts against limit.
        body: JSON.stringify({ sourceType: 'transcript', transcript }),
      });

    // Up to the limit: each NEW analysis is accepted (202).
    for (let i = 0; i < 2; i++) {
      const res = await submit(`unique transcript number ${i}`);
      assert.equal(res.status, 202, `submission ${i} should be accepted`);
    }

    // Over the limit: still a cache miss, but now rate-limited.
    const blocked = await submit('unique transcript over the limit');
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { error: string };
    assert.equal(body.error, 'rate_limited');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
