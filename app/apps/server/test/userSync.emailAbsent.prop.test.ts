// Feature: supabase-user-sync, Property 4: Email-absent validity and non-collision
// Validates: Requirements 5.1, 5.2

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

const MIN_RUNS = 100;

// Property 4 ---
// For any set of distinct subjects whose claims all omit an email, each subject
// becomes its own Local_User with email null, persisted without error and without
// any uniqueness conflict between them.
describe('Property 4: Email-absent validity and non-collision', () => {
  it('distinct email-absent subjects each persist with email null and never collide', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of distinct subjects (deduped UUIDs), each carrying an optional
        // role so present/absent role is covered, but never an email.
        fc.uniqueArray(
          fc.record({
            id: fc.uuid(),
            role: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 25, selector: (s) => s.id },
        ),
        async (subjects) => {
          const repo = new InMemoryRepository();

          // Each email-absent sync persists without error or uniqueness conflict
          // (Req 5.1, 5.2) — an absent email is a non-colliding value, so no
          // second-or-subsequent sync is rejected.
          for (const s of subjects) {
            await repo.ensureLocalUser({ id: s.id, role: s.role });
          }

          // Each subject is its own Local_User keyed to its subject, email null.
          for (const s of subjects) {
            const u = await repo.getLocalUser(s.id);
            assert.ok(u, `subject ${s.id} should have a Local_User`);
            assert.equal(u.id, s.id);
            assert.equal(u.email, null, 'email-absent sync must store email as null');
            assert.equal(u.role, s.role ?? 'user');
          }

          // No collision: the count of distinct Local_Users equals the count of
          // distinct subjects (Req 5.2).
          const distinctUsers = new Set<string>();
          for (const s of subjects) {
            const u = await repo.getLocalUser(s.id);
            distinctUsers.add(u!.id);
          }
          assert.equal(distinctUsers.size, subjects.length);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
