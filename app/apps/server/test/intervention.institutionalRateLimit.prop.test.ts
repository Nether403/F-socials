// Feature: intervention-and-scale, Property 18: Per-key rate limiting is correct and isolated
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { RateLimitConfig } from '../src/infra/ports';

// Arbitraries ---

/** A per-key Rate_Limit config: maxRequests ∈ [1,50], windowSeconds ∈ [1,86400] (Req 8.4). */
const cfgArb: fc.Arbitrary<RateLimitConfig> = fc.record({
  maxRequests: fc.integer({ min: 1, max: 50 }),
  windowSeconds: fc.integer({ min: 1, max: 86_400 }),
});

/** Two distinct key ids. */
const twoKeysArb: fc.Arbitrary<[string, string]> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.string({ minLength: 1, maxLength: 24 }),
  )
  // Guarantee distinctness so the isolation assertions are meaningful.
  .map(([a, b]) => [`A:${a}`, `B:${b}`] as [string, string]);

// Property 18 ---

describe('Property 18: Per-key rate limiting is correct and isolated', () => {
  it('remaining/allowed/limit/resetSeconds are correct across a hit sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        cfgArb,
        twoKeysArb,
        fc.integer({ min: 1, max: 120 }),
        async (cfg, [keyId], hits) => {
          // Fresh repo per run → fresh, isolated window state.
          const repo = new InMemoryRepository();

          // The window is created with expiresAt = now + windowSeconds*1000 and
          // windowSeconds ≥ 1, so it never expires during this synchronous-fast
          // loop. We track the expected count ourselves and check each hit.
          let count = 0;
          for (let i = 0; i < hits; i++) {
            count++;
            const r = await repo.institutionalHit(keyId, cfg);

            // limit always echoes the configured maxRequests (Req 8.3).
            assert.equal(r.limit, cfg.maxRequests, 'limit must equal maxRequests');

            // remaining === max(0, max - count) after each hit (Req 8.3).
            assert.equal(
              r.remaining,
              Math.max(0, cfg.maxRequests - count),
              `remaining mismatch at hit ${count} (max=${cfg.maxRequests})`,
            );

            // allow while count <= max, then 429-equivalent once exceeded (Req 8.1).
            assert.equal(
              r.allowed,
              count <= cfg.maxRequests,
              `allowed mismatch at hit ${count} (max=${cfg.maxRequests})`,
            );

            // resetSeconds is a whole number (Math.ceil) → Retry-After is whole
            // seconds (Req 8.1), and within the window bound.
            assert.ok(Number.isInteger(r.resetSeconds), `resetSeconds not whole: ${r.resetSeconds}`);
            assert.ok(
              r.resetSeconds >= 0 && r.resetSeconds <= cfg.windowSeconds,
              `resetSeconds ${r.resetSeconds} out of [0, ${cfg.windowSeconds}]`,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('two distinct keys are fully independent (per-key isolation)', async () => {
    await fc.assert(
      fc.asyncProperty(
        cfgArb,
        twoKeysArb,
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 1, max: 120 }),
        async (cfg, [keyA, keyB], hitsA, hitsB) => {
          const repo = new InMemoryRepository();

          // Drain key A first — possibly well past its limit (allowed → false).
          let lastA;
          for (let i = 0; i < hitsA; i++) lastA = await repo.institutionalHit(keyA, cfg);
          assert.ok(lastA);
          // A's allowed reflects A's own count, regardless of anything else.
          assert.equal(lastA.allowed, hitsA <= cfg.maxRequests);

          // Now hit key B: its window is its own, unaffected by A's exhaustion.
          let countB = 0;
          for (let i = 0; i < hitsB; i++) {
            countB++;
            const rB = await repo.institutionalHit(keyB, cfg);
            assert.equal(
              rB.remaining,
              Math.max(0, cfg.maxRequests - countB),
              "key B's remaining must depend only on B's own hits",
            );
            assert.equal(
              rB.allowed,
              countB <= cfg.maxRequests,
              "key B's allowed must depend only on B's own hits",
            );
          }

          // A's window is still intact: one more hit on A keeps counting from
          // where A left off (B's traffic never touched A's counter).
          const afterA = await repo.institutionalHit(keyA, cfg);
          assert.equal(afterA.remaining, Math.max(0, cfg.maxRequests - (hitsA + 1)));
          assert.equal(afterA.allowed, hitsA + 1 <= cfg.maxRequests);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('window resets after expiry — count restarts on the next hit (Req 8.2, 8.6)', async () => {
    // Deterministic without fake timers: a 1s window with a brief real wait. One
    // case only (kept off the 100-run loop) so the suite stays fast.
    const repo = new InMemoryRepository();
    const cfg: RateLimitConfig = { maxRequests: 2, windowSeconds: 1 };
    const key = 'reset-key';

    // Exhaust the window: 3rd hit exceeds the limit of 2.
    await repo.institutionalHit(key, cfg);
    const second = await repo.institutionalHit(key, cfg);
    assert.equal(second.allowed, true, 'hit 2 within limit');
    const third = await repo.institutionalHit(key, cfg);
    assert.equal(third.allowed, false, 'hit 3 exceeds limit');
    assert.equal(third.remaining, 0);

    // Wait out the 1s window (+ margin), then hit again → fresh window.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterReset = await repo.institutionalHit(key, cfg);
    assert.equal(afterReset.allowed, true, 'first hit after reset is allowed again');
    assert.equal(afterReset.remaining, cfg.maxRequests - 1, 'remaining restarts from max-1');
    assert.equal(afterReset.limit, cfg.maxRequests);
    assert.ok(Number.isInteger(afterReset.resetSeconds));
  });
});
