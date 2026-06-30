// Feature: supabase-user-sync, Property 1: Idempotent identity
// Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

const MIN_RUNS = 100;

// One ensureLocalUser call's claim shape. email/role are each independently
// present-or-absent so the generated sequences exercise the email-absent case,
// present/absent role, and repeated/interleaved syncs by construction.
type Claim = { email?: string; role?: string };

// Build the inline { id, email?, role? } argument for a subject, omitting any
// field the claim leaves absent (an omitted field is observably the same as an
// undefined one to ensureLocalUser, but omitting keeps the input faithful).
function callArgs(id: string, c: Claim): { id: string; email?: string; role?: string } {
  const args: { id: string; email?: string; role?: string } = { id };
  if (c.email !== undefined) args.email = c.email;
  if (c.role !== undefined) args.role = c.role;
  return args;
}

// A single claim: email and role are each optionally present (nil ⇒ absent).
const claimArb: fc.Arbitrary<Claim> = fc.record(
  {
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    role: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

// Property 1 ---

describe('Property 1: Idempotent identity', () => {
  it('any sequence of >=1 syncs of one subject yields exactly one user with id==subject and the first call\'s created_at', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(claimArb, { minLength: 1, maxLength: 12 }),
        async (subject, claims) => {
          const repo = new InMemoryRepository();

          // First call creates the Local_User (Req 1.1, 2.1, 2.2).
          await repo.ensureLocalUser(callArgs(subject, claims[0]!));

          const afterFirst = await repo.getLocalUser(subject);
          assert.ok(afterFirst, 'first sync must create a Local_User');
          assert.equal(afterFirst.id, subject, 'Local_User id must equal the subject (Req 1.2)');
          const firstCreatedAt = afterFirst.createdAt;

          // Every subsequent sync reuses the same single Local_User (Req 2.1, 2.2)
          // and preserves the subject key and original created_at (Req 2.3). Because
          // ensureLocalUser stamps created_at with new Date().toISOString() only on
          // the create branch, capturing it after the first call and asserting it is
          // unchanged after each later call proves the value is the first call's,
          // independent of timestamp resolution.
          for (let i = 1; i < claims.length; i++) {
            await repo.ensureLocalUser(callArgs(subject, claims[i]!));

            const current = await repo.getLocalUser(subject);
            assert.ok(current, 'Local_User must persist across repeat syncs');
            assert.equal(current.id, subject, 'id stays equal to the subject (Req 1.2, 2.3)');
            assert.equal(
              current.createdAt,
              firstCreatedAt,
              'created_at is preserved from the first call (Req 2.3)',
            );
          }

          // Exactly one Local_User per subject: getLocalUser resolves the subject,
          // and an unrelated subject never resolves to it (the store is keyed by
          // id, so one-per-subject holds by construction — Req 2.1).
          const finalUser = await repo.getLocalUser(subject);
          assert.ok(finalUser, 'subject must resolve to its single Local_User');
          assert.equal(finalUser.id, subject);
          assert.equal(finalUser.createdAt, firstCreatedAt);
          assert.equal(
            await repo.getLocalUser(`${subject}-absent`),
            undefined,
            'no Local_User exists for a never-synced subject',
          );
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
