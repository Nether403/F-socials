// Feature: institutional-workspace, Property 4: Invite redemption is well-bound and idempotent
// Validates: Requirements 2.1, 2.3, 2.4, 2.5
//
// For any workspace and any sequence of redemptions:
//   - Binding (Req 2.1, 2.3): createInvite returns a code bound to the workspace;
//     redeeming it creates a member-role Membership in exactly that workspace and
//     returns { workspaceId, role: 'member' }.
//   - Unknown code (Req 2.4): redeeming a code that matches no workspace returns
//     undefined and creates no Membership.
//   - Idempotency / role preservation (Req 2.5): redeeming repeatedly (same reader),
//     or when the reader is already a member (including the owner re-redeeming),
//     keeps exactly ONE Membership for that (workspace, reader) and leaves the
//     existing role unchanged — no duplicate, owner stays owner.
// Runs against the in-memory Repository with no API keys / no database — the
// offline-first path (Req 9.10).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Owner lives in the `O-` namespace; redeeming readers in the `R-` namespace, so a
// redeeming reader can deliberately equal the owner (to exercise the owner
// re-redeem case) only when explicitly generated as such.
const ownerArb = fc.string({ minLength: 1, maxLength: 16 }).map((s) => `O-${s}`);
const readerArb = fc.string({ minLength: 1, maxLength: 16 }).map((s) => `R-${s}`);
const nameArb = fc.string({ minLength: 1, maxLength: 100 });

// A redemption op: some reader redeems the workspace's code `repeats` times.
const redeemOpArb = fc.record({
  reader: readerArb,
  repeats: fc.integer({ min: 1, max: 4 }),
});

test('Property 4: invite redemption is well-bound and idempotent', async () => {
  await fc.assert(
    fc.asyncProperty(
      ownerArb,
      nameArb,
      fc.array(redeemOpArb, { minLength: 0, maxLength: 12 }),
      // Whether the owner also redeems their own workspace's invite.
      fc.boolean(),
      async (ownerId, name, ops, ownerRedeems) => {
        const repo = new InMemoryRepository();

        const ws = await repo.createWorkspace(ownerId, name);
        const code = await repo.createInvite(ws.id);

        // --- Unknown code (Req 2.4): no workspace matches → undefined, no Membership.
        const probe = `no-such-code-${name}`; // never collides with a randomUUID code
        const before = await repo.listMembers(ws.id);
        const unknown = await repo.redeemInvite(probe, 'R-probe');
        assert.equal(unknown, undefined, 'redeeming an unknown code must return undefined');
        assert.equal(
          await repo.getMembership(ws.id, 'R-probe'),
          undefined,
          'an unknown-code redemption must create no Membership',
        );
        assert.deepEqual(
          await repo.listMembers(ws.id),
          before,
          'an unknown-code redemption must leave members unchanged',
        );

        // Track the role we expect each reader to settle on. The owner starts as
        // 'owner'; any other reader becomes 'member' on first redeem.
        const expectedRole = new Map<string, 'owner' | 'member'>([[ownerId, 'owner']]);

        const redeemOps = ownerRedeems ? [...ops, { reader: ownerId, repeats: 2 }] : ops;
        for (const op of redeemOps) {
          // First redeem by a brand-new reader binds them as 'member'; the owner
          // (or an already-joined reader) keeps their existing role.
          const settled = expectedRole.get(op.reader) ?? 'member';
          expectedRole.set(op.reader, settled);
          for (let i = 0; i < op.repeats; i++) {
            const res = await repo.redeemInvite(code, op.reader);
            // Binding + role (Req 2.1, 2.3, 2.5): bound to this workspace, role stable.
            assert.deepEqual(
              res,
              { workspaceId: ws.id, role: settled },
              'redeem must return the bound workspace id and the stable role',
            );
            // Idempotency (Req 2.5): the live Membership matches the settled role.
            assert.equal(
              await repo.getMembership(ws.id, op.reader),
              settled,
              'getMembership must reflect the settled role after every redeem',
            );
          }
        }

        // Exactly one Membership per reader — no duplicates (Req 2.5).
        const members = await repo.listMembers(ws.id);
        const ids = members.map((m) => m.readerId);
        assert.equal(
          ids.length,
          new Set(ids).size,
          'each reader must hold exactly one Membership (no duplicates)',
        );
        // The owner Membership persists with the Owner role (Req 2.5).
        assert.equal(
          members.find((m) => m.readerId === ownerId)?.role,
          'owner',
          'the owner must remain owner after any number of redemptions',
        );
        // Every reader that redeemed holds the expected role in this workspace,
        // and in no other (membership is bound to ws.id only).
        for (const [reader, role] of expectedRole) {
          assert.equal(
            members.find((m) => m.readerId === reader)?.role,
            role,
            `reader ${reader} must hold role ${role} in the bound workspace`,
          );
        }
      },
    ),
    { numRuns: 100 },
  );
});
