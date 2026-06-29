// Feature: institutional-workspace, Property 9: Workspace creation seeds the owner and the owner Membership always persists
// Validates: Requirements 1.1, 3.4
//
// Two coupled guarantees about the Owner Membership:
//
//   (a) Seeding (Req 1.1): createWorkspace yields EXACTLY one Membership — the
//       owner's, with role 'owner'. Immediately after creation listMembers is a
//       singleton [{ owner, 'owner' }], getMembership(ws, owner) === 'owner', and
//       the workspace appears in the owner's workspace list with the Owner Role.
//
//   (b) Retention (Req 3.4): across ANY sequence of other members joining and
//       being removed, the owner Membership persists unchanged — getMembership
//       still returns 'owner' and listMembers still contains the owner as 'owner'.
//       The route-layer guard forbids the owner removing their own Membership
//       (HTTP 400 before any delete), so the generated sequence models exactly
//       that: removeMember is only ever called on NON-owner readers. The invariant
//       under test is that no such non-owner member-management sequence can ever
//       drop or downgrade the seeded owner.
//
// The InMemoryRepository is the only persistence path and is atomic by
// construction (no `await` between read and write). We pick a distinct owner and
// a pool of non-owner readers, then drive an arbitrary interleaving of joins
// (createInvite + redeemInvite) and removals (removeMember on a non-owner),
// asserting the owner invariant holds after creation and after every operation.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Member-management operations on NON-owner readers only. `reader` is an index
// into the non-owner pool, resolved with a guarded modulo so it always lands on
// a real, non-owner reader (never the owner — that models the route guard).
type Op = { kind: 'add' | 'remove'; reader: number };

// A distinct owner plus a small pool of other readers (small so the same reader
// joins and is removed repeatedly — the interleaving that would expose a drop of
// the owner). uniqueArray guarantees owner ∉ pool and pool entries are distinct.
const scenarioArb = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 })
  .chain((readers) =>
    fc.record({
      owner: fc.constant(readers[0] as string),
      pool: fc.constant(readers.slice(1)),
      name: fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Delta'),
      ops: fc.array(
        fc.record({
          kind: fc.constantFrom('add' as const, 'remove' as const),
          reader: fc.nat(),
        }),
        { maxLength: 40 },
      ),
    }),
  );

test('Property 9: workspace creation seeds exactly the owner, and the owner Membership always persists', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ owner, pool, name, ops }) => {
      const repo = new InMemoryRepository();

      // (a) Seeding: creation yields exactly the owner Membership (Req 1.1).
      const ws = await repo.createWorkspace(owner, name);
      assert.equal(ws.role, 'owner', 'creation must return the owner role');

      const seeded = await repo.listMembers(ws.id);
      assert.deepEqual(
        seeded,
        [{ readerId: owner, role: 'owner' }],
        'creation must seed exactly one Membership: the owner as owner',
      );
      assert.equal(await repo.getMembership(ws.id, owner), 'owner');
      const ownerWs = await repo.listWorkspacesForReader(owner);
      assert.deepEqual(ownerWs, [{ id: ws.id, name, role: 'owner' }], 'owner must see the new workspace as owner');

      // The owner invariant, re-checkable after every operation (Req 3.4).
      const assertOwnerPersists = async () => {
        assert.equal(
          await repo.getMembership(ws.id, owner),
          'owner',
          'owner Membership must persist with role owner',
        );
        const members = await repo.listMembers(ws.id);
        const ownerRow = members.find((m) => m.readerId === owner);
        assert.ok(ownerRow, 'listMembers must always contain the owner');
        assert.equal(ownerRow.role, 'owner', 'owner role must never be downgraded');
      };

      // (b) Retention: arbitrary non-owner joins/removals never drop the owner.
      for (const op of ops) {
        if (pool.length === 0) break; // no non-owner reader to act on
        const reader = pool[op.reader % pool.length] as string;
        if (op.kind === 'add') {
          const code = await repo.createInvite(ws.id);
          await repo.redeemInvite(code, reader);
        } else {
          // removeMember is called ONLY on non-owner readers — the route guard
          // (Req 3.4) prevents the owner from removing their own Membership.
          await repo.removeMember(ws.id, reader);
        }
        await assertOwnerPersists();
      }

      // Final check after the whole sequence.
      await assertOwnerPersists();
    }),
    { numRuns: 100 },
  );
});
