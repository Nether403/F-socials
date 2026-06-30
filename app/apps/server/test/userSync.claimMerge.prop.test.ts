// Feature: supabase-user-sync, Property 2: Claim reflection with retain
// Validates: Requirements 1.4, 1.5, 2.4, 2.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

const MIN_RUNS = 100;

// A single ensureLocalUser call's claims. Each of email/role is independently
// present or absent — fc.record with requiredKeys [] omits the key when the
// generator chooses absence, mirroring an omitted JWT claim (Req 2.5).
type Call = { email?: string; role?: string };

const callArb: fc.Arbitrary<Call> = fc.record(
  {
    // Non-empty so a present-but-empty value never aliases an absent claim in the
    // expected-value tracking; the merge itself keys on presence, not content.
    email: fc.string({ minLength: 1, maxLength: 50 }),
    role: fc.string({ minLength: 1, maxLength: 50 }),
  },
  { requiredKeys: [] },
);

describe('Property 2: Claim reflection with retain', () => {
  it('stored email/role equal the most recent providing call and are retained when later calls omit them', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(callArb, { minLength: 1, maxLength: 20 }),
        async (subject, calls) => {
          const repo = new InMemoryRepository();

          // Expected "most recent present value" tracked independently per field.
          // Defaults match ensureLocalUser's create path: email null when never
          // provided (Req 5.1), role 'user' when never provided (Req 1.5).
          let expectedEmail: string | null = null;
          let expectedRole = 'user';

          for (const call of calls) {
            await repo.ensureLocalUser({ id: subject, ...call });

            // A present claim updates (Req 1.4, 1.5, 2.4); an absent one retains
            // the prior value (Req 2.5).
            if (call.email !== undefined) expectedEmail = call.email;
            if (call.role !== undefined) expectedRole = call.role;

            const stored = await repo.getLocalUser(subject);
            assert.ok(stored, 'a Local_User must exist after a sync');
            assert.equal(stored.id, subject);
            assert.equal(stored.email, expectedEmail);
            assert.equal(stored.role, expectedRole);
          }
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
