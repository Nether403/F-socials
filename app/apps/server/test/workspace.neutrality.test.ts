// Feature: institutional-workspace, Property 10: Workspace responses and the annotation model are lens-not-judge
// Validates: Requirements 10.4, 10.5
//
// f-Socials is a lens, not a judge. Over arbitrary generated workspace state
// (workspaces, members, collections, items, annotations), every object returned
// by the repository projections — createWorkspace, listWorkspacesForReader,
// listMembers, listCollections, listCollectionItems, createAnnotation,
// listAnnotations, getAnnotation — must be lens-safe: its key set carries
//   - NO content-truthfulness verdict field,
//   - NO creator-reliability rating field, and
//   - NO creator-attached source tier field (tiers belong only on a source/
//     citation, which these projections do not carry).
//
// We drive the InMemoryRepository with a generated sequence of operations across
// shared pools of owners, joiners, and reports (so states vary widely: empty,
// single, many, post-removal), then collect EVERY object each projection returns
// and assert two things against each:
//   1. its key set equals exactly the expected lens-safe allow-list, and
//   2. recursively, no key anywhere (case-insensitive) matches a denylist of
//      forbidden verdict / rating / tier substrings.
// The denylist catches any future verdict/rating/tier dimension introduced on
// these shapes, not just the field names known today.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Forbidden substrings: any key matching these (case-insensitive) would betray a
// content-truthfulness verdict, a creator-reliability rating, or a creator-
// attached source tier. None of the lens-safe projection keys (id, name, role,
// readerId, reportId, addedAt, workspaceId, authorId, text, createdAt, updatedAt)
// match, by construction (Req 10.4, 10.5).
const FORBIDDEN_KEY =
  /tier|verdict|truth|rating|score|credib|trustworth|reliab|grade|judg/i;

// The exact lens-safe key set each projection may carry. Anything outside these
// sets is, by construction, not a neutral projection field and must not appear.
const EXPECTED_KEYS = {
  WorkspaceSummary: ['id', 'name', 'role'],
  Membership: ['readerId', 'role'],
  SharedCollection: ['id', 'name'],
  CollectionItemEntry: ['addedAt', 'reportId'],
  Annotation: ['authorId', 'createdAt', 'id', 'reportId', 'text', 'updatedAt', 'workspaceId'],
} as const;

// Collect every property key appearing anywhere in a value (nested objects and
// arrays). Primitives contribute nothing.
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const el of value) collectKeys(el, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

// Assert no key anywhere trips the verdict/rating/tier denylist.
function assertNoForbiddenKey(value: unknown, label: string): void {
  for (const key of collectKeys(value)) {
    assert.ok(
      !FORBIDDEN_KEY.test(key),
      `${label} exposes a verdict/rating/tier key "${key}"`,
    );
  }
}

// Assert a single projection object is exactly its expected lens-safe key set
// AND trips no denylist key.
function assertProjection(obj: object, expected: readonly string[], label: string): void {
  assert.deepEqual(
    Object.keys(obj).sort(),
    [...expected].sort(),
    `${label} must be exactly { ${expected.join(', ')} }`,
  );
  assertNoForbiddenKey(obj, label);
}

// A generated scenario: small pools of owners, joiners, and reports so the same
// reader belongs to several workspaces and the same report is collected/annotated
// in more than one — then a sequence of operations drawn from those pools.
const scenarioArb = fc
  .record({
    owners: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
    joiners: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
    reports: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
    names: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
    texts: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
  })
  .filter((s) => s.names.length > 0 && s.texts.length > 0)
  .chain((pools) =>
    fc.record({
      pools: fc.constant(pools),
      // How many workspaces to create (each owned by an owner from the pool).
      workspaceCount: fc.integer({ min: 1, max: 4 }),
      // Post-creation operations, indices resolved against the pools/created ids.
      ops: fc.array(
        fc.oneof(
          fc.record({ kind: fc.constant('join' as const), ws: fc.nat(), reader: fc.nat() }),
          fc.record({ kind: fc.constant('collection' as const), ws: fc.nat(), name: fc.nat() }),
          fc.record({ kind: fc.constant('addItem' as const), coll: fc.nat(), report: fc.nat() }),
          fc.record({ kind: fc.constant('removeItem' as const), coll: fc.nat(), report: fc.nat() }),
          fc.record({ kind: fc.constant('annotate' as const), ws: fc.nat(), report: fc.nat(), text: fc.nat() }),
        ),
        { maxLength: 40 },
      ),
    }),
  );

const pick = <T>(arr: readonly T[], i: number): T | undefined =>
  arr.length === 0 ? undefined : arr[i % arr.length];

test('Property 10: every workspace projection is lens-not-judge (no verdict, rating, or creator tier)', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ pools, workspaceCount, ops }) => {
      const repo = new InMemoryRepository();
      const { owners, joiners, reports, names, texts } = pools;

      const workspaceIds: string[] = [];
      const collectionIds: string[] = [];
      const annotationIds: string[] = [];
      // (workspaceId, reportId) pairs that have at least one annotation, so we can
      // exercise listAnnotations over a populated scope.
      const annotatedScopes: Array<{ ws: string; report: string }> = [];

      // Create workspaces — assert createWorkspace's projection up front.
      for (let i = 0; i < workspaceCount; i++) {
        const owner = pick(owners, i)!;
        const name = pick(names, i)!;
        const ws = await repo.createWorkspace(owner, name);
        assertProjection(ws, EXPECTED_KEYS.WorkspaceSummary, 'createWorkspace');
        workspaceIds.push(ws.id);
      }

      // Apply the generated operation sequence.
      for (const op of ops) {
        if (op.kind === 'join') {
          const ws = pick(workspaceIds, op.ws);
          const reader = pick(joiners, op.reader);
          if (!ws || !reader) continue;
          // Redeem through a freshly issued invite so the binding is real.
          const code = await repo.createInvite(ws);
          await repo.redeemInvite(code, reader);
        } else if (op.kind === 'collection') {
          const ws = pick(workspaceIds, op.ws);
          const name = pick(names, op.name);
          if (!ws || name === undefined) continue;
          const coll = await repo.createCollection(ws, name);
          assertProjection(coll, EXPECTED_KEYS.SharedCollection, 'createCollection');
          collectionIds.push(coll.id);
        } else if (op.kind === 'addItem') {
          const coll = pick(collectionIds, op.coll);
          const report = pick(reports, op.report);
          if (!coll || !report) continue;
          await repo.addCollectionItem(coll, report);
        } else if (op.kind === 'removeItem') {
          const coll = pick(collectionIds, op.coll);
          const report = pick(reports, op.report);
          if (!coll || !report) continue;
          await repo.removeCollectionItem(coll, report);
        } else {
          const ws = pick(workspaceIds, op.ws);
          const report = pick(reports, op.report);
          const text = pick(texts, op.text);
          const author = pick([...owners, ...joiners], op.report);
          if (!ws || !report || text === undefined || !author) continue;
          const ann = await repo.createAnnotation({ workspaceId: ws, reportId: report, authorId: author, text });
          assertProjection(ann, EXPECTED_KEYS.Annotation, 'createAnnotation');
          annotationIds.push(ann.id);
          annotatedScopes.push({ ws, report });
        }
      }

      // Read-side projections over the resulting state.
      for (const reader of [...owners, ...joiners, 'never-seen-reader']) {
        const list = await repo.listWorkspacesForReader(reader);
        for (const ws of list) assertProjection(ws, EXPECTED_KEYS.WorkspaceSummary, 'listWorkspacesForReader');
      }

      for (const ws of workspaceIds) {
        for (const m of await repo.listMembers(ws)) {
          assertProjection(m, EXPECTED_KEYS.Membership, 'listMembers');
        }
        for (const c of await repo.listCollections(ws)) {
          assertProjection(c, EXPECTED_KEYS.SharedCollection, 'listCollections');
        }
      }

      for (const coll of collectionIds) {
        for (const item of await repo.listCollectionItems(coll)) {
          assertProjection(item, EXPECTED_KEYS.CollectionItemEntry, 'listCollectionItems');
        }
      }

      for (const { ws, report } of annotatedScopes) {
        for (const ann of await repo.listAnnotations(ws, report)) {
          assertProjection(ann, EXPECTED_KEYS.Annotation, 'listAnnotations');
        }
      }

      for (const id of annotationIds) {
        const ann = await repo.getAnnotation(id);
        assert.ok(ann, 'getAnnotation must return the created annotation');
        assertProjection(ann, EXPECTED_KEYS.Annotation, 'getAnnotation');
      }
    }),
    { numRuns: 100 },
  );
});
