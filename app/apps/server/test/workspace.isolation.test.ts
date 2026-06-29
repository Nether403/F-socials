// Feature: institutional-workspace, Property 3: Membership-scoped isolation
// Validates: Requirements 3.1, 4.1, 4.2, 4.3, 5.2, 9.8
//
// With arbitrary generated state of multiple readers creating workspaces,
// redeeming invites, and creating collections, for any reader and any workspace
// the data returned to that reader includes ONLY workspaces in which the reader
// holds a Membership and excludes every other workspace's data:
//
//   - listWorkspacesForReader(reader) returns EXACTLY the set of workspaces the
//     reader is a member of (with the correct role), and [] when none (Req 4.1,
//     4.2, 4.3).
//   - listMembers / listCollections are workspace-scoped: each returns only the
//     data belonging to that one workspace and excludes every other workspace's
//     members/collections (Req 3.1, 5.2, 9.8). A reader holding no Membership in
//     a workspace never sees that workspace via its own list, so its members and
//     collections never reach that reader.
//
// We generate operations over a SMALL shared pool of readers so the same reader
// joins multiple workspaces and the same workspace gains multiple members — the
// overlap that would expose a cross-workspace or cross-reader leak. A model
// (membership Map + per-workspace collection set) records the intended state;
// the repository reads must match it exactly with nothing leaked in or out.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { WorkspaceRole } from '../src/infra/ports';

// Abstract operations executed in order. Workspaces are referenced by an index
// resolved against the workspaces created SO FAR (mod), so an op that references
// a not-yet-existing workspace is simply skipped when none exist.
type Op =
  | { kind: 'createWorkspace'; owner: string }
  | { kind: 'redeem'; wsPick: number; reader: string }
  | { kind: 'createCollection'; wsPick: number };

const scenarioArb = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 })
  .chain((readers) =>
    fc.record({
      readers: fc.constant(readers),
      // A fresh reader that performs no operation — must see an empty list.
      untouchedReader: fc.uuid(),
      ops: fc.array(
        fc.oneof(
          fc.record({ kind: fc.constant('createWorkspace' as const), owner: fc.constantFrom(...readers) }),
          fc.record({ kind: fc.constant('redeem' as const), wsPick: fc.nat(), reader: fc.constantFrom(...readers) }),
          fc.record({ kind: fc.constant('createCollection' as const), wsPick: fc.nat() }),
        ),
        { maxLength: 40 },
      ),
    }),
  );

test('Property 3: membership-scoped isolation — readers see only their workspaces, each workspace only its own data', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ readers, untouchedReader, ops }) => {
      const repo = new InMemoryRepository();

      // Model. Created workspace ids in creation order, the intended membership
      // (workspaceId -> reader -> role), and the intended collections per
      // workspace (workspaceId -> Set<collectionId>).
      const workspaceIds: string[] = [];
      const membership = new Map<string, Map<string, WorkspaceRole>>();
      const collectionsByWorkspace = new Map<string, Set<string>>();

      for (const op of ops) {
        if (op.kind === 'createWorkspace') {
          const ws = await repo.createWorkspace(op.owner, `ws-${workspaceIds.length}`);
          workspaceIds.push(ws.id);
          membership.set(ws.id, new Map([[op.owner, 'owner']]));
          collectionsByWorkspace.set(ws.id, new Set());
          continue;
        }
        if (workspaceIds.length === 0) continue; // no workspace to target yet
        const wsId = workspaceIds[op.wsPick % workspaceIds.length];
        if (wsId === undefined) continue; // noUncheckedIndexedAccess: length>0 guarantees in-range

        if (op.kind === 'redeem') {
          const code = await repo.createInvite(wsId);
          await repo.redeemInvite(code, op.reader);
          const members = membership.get(wsId)!;
          // Idempotent: an existing member keeps its role; otherwise join as member.
          if (!members.has(op.reader)) members.set(op.reader, 'member');
        } else {
          const col = await repo.createCollection(wsId, `col-${collectionsByWorkspace.get(wsId)!.size}`);
          collectionsByWorkspace.get(wsId)!.add(col.id);
        }
      }

      // Precompute, per reader, the exact set of workspace ids they belong to.
      const expectedWorkspacesByReader = new Map<string, Map<string, WorkspaceRole>>();
      for (const r of readers) expectedWorkspacesByReader.set(r, new Map());
      for (const [wsId, members] of membership) {
        for (const [reader, role] of members) {
          expectedWorkspacesByReader.get(reader)?.set(wsId, role);
        }
      }

      // Every collection id in the whole system, with the workspace that owns it,
      // so we can assert no collection leaks across workspace boundaries.
      const ownerWorkspaceOfCollection = new Map<string, string>();
      for (const [wsId, cols] of collectionsByWorkspace) {
        for (const cid of cols) ownerWorkspaceOfCollection.set(cid, wsId);
      }

      for (const reader of readers) {
        const expected = expectedWorkspacesByReader.get(reader)!;

        // (1) listWorkspacesForReader returns EXACTLY the reader's workspaces with
        //     correct roles, no duplicates, nothing leaked in (Req 4.1, 4.2, 4.3).
        const listed = await repo.listWorkspacesForReader(reader);
        const listedIds = listed.map((w) => w.id);
        assert.equal(listedIds.length, new Set(listedIds).size, 'workspace list contains a duplicate');
        assert.deepEqual(new Set(listedIds), new Set(expected.keys()), "workspace list != reader's membership set");
        for (const w of listed) {
          assert.equal(w.role, expected.get(w.id), `wrong role for workspace ${w.id}`);
        }

        // (2) For each workspace the reader belongs to, the workspace-scoped reads
        //     return ONLY that workspace's data and exclude every other's
        //     (Req 3.1, 5.2, 9.8).
        for (const wsId of expected.keys()) {
          const membersListed = await repo.listMembers(wsId);
          const memberIds = membersListed.map((m) => m.readerId);
          assert.deepEqual(
            new Set(memberIds),
            new Set(membership.get(wsId)!.keys()),
            `members of ${wsId} != model membership`,
          );
          for (const m of membersListed) {
            assert.equal(m.role, membership.get(wsId)!.get(m.readerId), 'member role mismatch');
          }

          const colsListed = await repo.listCollections(wsId);
          const colIds = colsListed.map((c) => c.id);
          assert.deepEqual(
            new Set(colIds),
            collectionsByWorkspace.get(wsId)!,
            `collections of ${wsId} != model collections`,
          );
          // Explicit exclusion: no collection from a different workspace appears.
          for (const cid of colIds) {
            assert.equal(ownerWorkspaceOfCollection.get(cid), wsId, `collection ${cid} leaked from another workspace`);
          }
        }
      }

      // (3) A reader holding no Membership anywhere gets an empty list (Req 4.3) —
      //     both a fresh, never-seen id and any pool reader who joined nothing.
      const emptyReaders = [untouchedReader, ...readers.filter((r) => expectedWorkspacesByReader.get(r)!.size === 0)];
      for (const reader of emptyReaders) {
        assert.deepEqual(await repo.listWorkspacesForReader(reader), []);
      }
    }),
    { numRuns: 100 },
  );
});
