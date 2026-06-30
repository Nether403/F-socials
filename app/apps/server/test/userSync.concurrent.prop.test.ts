// Feature: supabase-user-sync, Property 3: Concurrent convergence
// Validates: Requirements 2.6

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Arbitraries ---

/**
 * One ensureLocalUser claim payload (sans subject). Varies the optional email
 * (absent/present) and role (absent/present) independently so a concurrent
 * batch covers the full create/merge claim space (Req 2.6).
 */
const claimArb: fc.Arbitrary<{ email?: string; role?: string }> = fc.record(
  {
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    role: fc.option(fc.constantFrom('user', 'admin', 'moderator'), { nil: undefined }),
  },
  { requiredKeys: [] },
);

/** N ≥ 2 varied claim payloads fired concurrently for a single subject. */
const concurrentClaimsArb: fc.Arbitrary<Array<{ email?: string; role?: string }>> =
  fc.array(claimArb, { minLength: 2, maxLength: 16 });

// Property 3 ---

describe('Property 3: Concurrent convergence', () => {
  it('N concurrent ensureLocalUser calls for one subject settle to exactly one Local_User', async () => {
    await fc.assert(
      fc.asyncProperty(concurrentClaimsArb, async (claims) => {
        // A fresh subject + fresh repo per run.
        const subject = randomUUID();
        const repo = new InMemoryRepository();

        // Fire all N calls concurrently and wait for every one to settle.
        await Promise.all(
          claims.map((c) => repo.ensureLocalUser({ id: subject, ...c })),
        );

        // Exactly one Local_User exists for the subject, keyed to it (Req 2.6).
        const user = await repo.getLocalUser(subject);
        assert.ok(user, 'a Local_User must exist for the subject after concurrent syncs');
        assert.equal(user.id, subject, 'the Local_User id must equal the subject');
      }),
      { numRuns: 100 },
    );
  });
});
