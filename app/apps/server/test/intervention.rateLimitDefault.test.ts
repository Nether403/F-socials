import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRateConfig } from '../src/concurrency';
import { InMemoryRepository } from '../src/infra/memory';

// Feature: intervention-and-scale — example test for the default per-key rate config.
// Validates: Requirements 8.5 (unconfigured key => default 100 / 60s) and the
// windowSeconds [1, 86400] clamp (Req 8.4).
describe('intervention: resolveRateConfig default rate limit', () => {
  it('applies the 100 / 60s default when a key carries no configured override', () => {
    assert.deepEqual(resolveRateConfig(undefined), { maxRequests: 100, windowSeconds: 60 });
  });

  it('passes a valid configured override through unchanged', () => {
    assert.deepEqual(resolveRateConfig({ maxRequests: 5, windowSeconds: 30 }), {
      maxRequests: 5,
      windowSeconds: 30,
    });
  });

  it('clamps windowSeconds to the [1, 86400] bounds', () => {
    assert.equal(resolveRateConfig({ maxRequests: 10, windowSeconds: 999999 }).windowSeconds, 86400);
    assert.equal(resolveRateConfig({ maxRequests: 10, windowSeconds: 0 }).windowSeconds, 1);
  });

  it('applies the default 100-request limit end-to-end via institutionalHit', async () => {
    const repo = new InMemoryRepository();
    const cfg = resolveRateConfig(undefined);
    const keyId = 'key-default';
    // The first 100 hits are within the default limit; the 101st is over.
    let last = await repo.institutionalHit(keyId, cfg);
    for (let i = 1; i < 100; i++) {
      last = await repo.institutionalHit(keyId, cfg);
    }
    assert.equal(last.allowed, true, '100th hit is within the default limit');
    const over = await repo.institutionalHit(keyId, cfg);
    assert.equal(over.allowed, false, '101st hit exceeds the default 100-request limit');
  });
});
