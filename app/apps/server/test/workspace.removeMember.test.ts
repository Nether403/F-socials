// Feature: institutional-workspace, Property 5: Member removal revokes access and does not interfere
// Validates: Requirements 3.2, 3.5
//
// For any state of multiple workspaces, each with an owner and a set of members,
// removing one (workspace, reader) Membership:
//   - deletes ONLY that Membership — every other member's Membership in this and
//     in every other workspace is left byte-for-byte unchanged (Req 3.2);
//   - revokes that reader's access to the workspace: getMembership then returns
//     undefined, the workspace no longer appears in listWorkspacesForReader for
//     that reader, and listMembers no longer includes the reader (Req 3.5);
//   - leaves the reader's Memberships in OTHER workspaces intact (cross-workspace
//     non-interference — the same reader can belong to several workspaces).
//
// The InMemoryRepository is the only persistence path and is atomic by
// construction (no `await` between read and write in removeMember). We build
// arbitrary multi-workspace state via createWorkspace + createInvite/redeemInvite,
// snapshot every workspace's member set, remove an arbitrary (workspace, reader),
// and assert the target pair is gone while every other pair — in this and every
// other workspace — is preserved.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Small pools so collisions actually happen: the same reader joins several
// workspaces (exercising cross-workspace non-interference) and the same reader
// redeems repeatedly (exercising idempotent membership).
const readerArb = fc.constantFrom('r1', 'r2', 'r3', 'r4', 'r5');
const nameArb = fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Delta');

// One workspace: an owner plus a set of readers who redeem an invite to join.
const workspaceSpecArb = fc.record({
  owner: readerArb,
  name: nameArb,
  joiners: fc.array(readerArb, { maxLength: 5 }),
});
const specsArb = fc.array(workspaceSpecArb, { minLength: 1, maxLength: 4 });

// Snapshot a workspace's membership as a sorted list of "reader:role" strings.
async function memberSnapshot(repo: InMemoryRepository, wsIds: readonly string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const id of wsIds) {
    out[id] = (await repo.listMembers(id)).map((m) => `${m.readerId}:${m.role}`).sort();
  }
  return out;
}

test('Property 5: member removal revokes access and does not interfere', async () => {
  await fc.assert(
    fc.asyncProperty(specsArb, fc.nat(), readerArb, async (specs, wsPick, targetReader) => {
      const repo = new InMemoryRepository();

      // Build arbitrary multi-workspace state.
      const wsIds: string[] = [];
      for (const spec of specs) {
        const ws = await repo.createWorkspace(spec.owner, spec.name);
        wsIds.push(ws.id);
        for (const j of spec.joiners) {
          const code = await repo.createInvite(ws.id);
          await repo.redeemInvite(code, j);
        }
      }

      const targetWsId = wsIds[wsPick % wsIds.length]!;

      const before = await memberSnapshot(repo, wsIds);

      await repo.removeMember(targetWsId, targetReader);

      const after = await memberSnapshot(repo, wsIds);

      // Access revoked for the target (workspace, reader) — whether or not it was
      // a member to begin with: getMembership returns none (Req 3.5).
      assert.equal(
        await repo.getMembership(targetWsId, targetReader),
        undefined,
        'getMembership should return undefined after removal',
      );

      // The target workspace no longer appears in the removed reader's list,
      // even though OTHER workspaces the reader belongs to still may (Req 3.5).
      const readerWorkspaces = await repo.listWorkspacesForReader(targetReader);
      assert.ok(
        !readerWorkspaces.some((w) => w.id === targetWsId),
        'removed workspace must not appear in the reader workspace list',
      );

      // listMembers for the target workspace excludes the removed reader.
      const targetMembers = await repo.listMembers(targetWsId);
      assert.ok(
        !targetMembers.some((m) => m.readerId === targetReader),
        'listMembers must not include the removed reader',
      );

      // Only the target Membership changed: the target workspace's member set is
      // exactly the prior set minus the removed reader (Req 3.2)...
      const expectedTarget = before[targetWsId]!.filter((s) => !s.startsWith(`${targetReader}:`));
      assert.deepEqual(after[targetWsId], expectedTarget, 'target workspace differs only by the removed member');

      // ...and every OTHER workspace is untouched — including any holding the
      // removed reader's Membership (cross-workspace non-interference, Req 3.2).
      for (const id of wsIds) {
        if (id === targetWsId) continue;
        assert.deepEqual(after[id], before[id], `non-target workspace ${id} must be untouched`);
      }
    }),
    { numRuns: 100 },
  );
});
