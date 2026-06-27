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
