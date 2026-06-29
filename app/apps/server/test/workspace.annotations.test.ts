// Feature: institutional-workspace, Property 8: Annotations are recorded, workspace-scoped, and ordered
// Validates: Requirements 7.1, 7.2
//
// For any set of annotations created across multiple (workspace, report) pairs
// with various authors and texts:
//   - each created Annotation faithfully records workspaceId, reportId, authorId,
//     text, and createdAt/updatedAt (Req 7.1);
//   - listAnnotations(ws, report) returns exactly the annotations created for
//     that (workspace, report) pair and excludes every other workspace's and
//     every other report's annotation (Req 7.2 scope);
//   - results are ordered createdAt DESC then id DESC, identical across repeated
//     calls (Req 7.2 order).
//
// The InMemoryRepository stamps createdAt/updatedAt from `new Date().toISOString()`,
// so to make the id-DESC tie-break observable rather than incidental we control
// timing: each create's timestamp is drawn from a small fixed pool, guaranteeing
// equal-createdAt collisions across distinct annotations. Date is stubbed only
// around the create loop (restored in a finally); createAnnotation always inserts
// a fresh row (unique random id), consuming exactly one queued timestamp per call.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { Annotation } from '../src/infra/ports';

// A small pool of DISTINCT ISO-8601 timestamps. With more creates than pool
// slots, equal-createdAt groups are guaranteed, which is what makes the id-DESC
// tie-break observable.
const TIMESTAMP_POOL = [
  '2021-01-01T00:00:00.000Z',
  '2022-06-15T12:30:00.000Z',
  '2023-03-20T08:00:00.000Z',
  '2024-11-30T23:59:59.999Z',
];

// One generated scenario: small overlapping pools of workspaces, reports, and
// authors (so the same report id appears under several workspaces and vice
// versa — the case that catches a scope leak), plus a sequence of annotation
// creates drawn from those pools, each carrying a text and a pooled timestamp.
const scenarioArb = fc
  .record({
    workspaces: fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 4 }),
    reports: fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 4 }),
    authors: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
  })
  .chain(({ workspaces, reports, authors }) =>
    fc.record({
      workspaces: fc.constant(workspaces),
      reports: fc.constant(reports),
      ops: fc.array(
        fc.record({
          workspaceId: fc.constantFrom(...workspaces),
          reportId: fc.constantFrom(...reports),
          authorId: fc.constantFrom(...authors),
          text: fc.string({ minLength: 1, maxLength: 60 }),
          ts: fc.constantFrom(...TIMESTAMP_POOL),
        }),
        { minLength: 1, maxLength: 30 },
      ),
    }),
  );

// The reference comparator: createdAt DESC, then id DESC. The independent oracle
// the repository's listed order must match.
function expectedOrder(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) =>
    a.createdAt < b.createdAt ? 1
    : a.createdAt > b.createdAt ? -1
    : a.id < b.id ? 1
    : a.id > b.id ? -1
    : 0,
  );
}

test('Property 8: annotations are recorded, workspace-scoped, and ordered (createdAt DESC, id DESC)', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ workspaces, reports, ops }) => {
      const repo = new InMemoryRepository();

      // Drive createdAt/updatedAt deterministically: each create pops the next
      // queued timestamp. createAnnotation stamps once per call and always
      // inserts a fresh row, so the queue advances exactly once per op.
      const RealDate = globalThis.Date;
      const queue = ops.map((o) => o.ts);
      let i = 0;
      class FakeDate extends RealDate {
        toISOString(): string {
          return queue[i++]!;
        }
      }

      // Model: every created annotation, captured from the create response.
      const created: Annotation[] = [];
      globalThis.Date = FakeDate as DateConstructor;
      try {
        for (const op of ops) {
          const a = await repo.createAnnotation({
            workspaceId: op.workspaceId,
            reportId: op.reportId,
            authorId: op.authorId,
            text: op.text,
          });
          created.push(a);
        }
      } finally {
        globalThis.Date = RealDate;
      }

      // 1) Recorded faithfully (Req 7.1): each created Annotation echoes the
      //    input fields and stamps createdAt === updatedAt from the queued time.
      for (let k = 0; k < ops.length; k++) {
        const op = ops[k]!;
        const a = created[k]!;
        assert.equal(a.workspaceId, op.workspaceId, 'workspaceId not recorded');
        assert.equal(a.reportId, op.reportId, 'reportId not recorded');
        assert.equal(a.authorId, op.authorId, 'authorId not recorded');
        assert.equal(a.text, op.text, 'text not recorded');
        assert.equal(a.createdAt, queue[k], 'createdAt not recorded');
        assert.equal(a.updatedAt, queue[k], 'updatedAt not recorded');
        assert.ok(typeof a.id === 'string' && a.id.length > 0, 'id not assigned');
      }

      // Exercise every (workspace, report) pair in the pools — both pairs that
      // received annotations and pairs that did not.
      for (const ws of workspaces) {
        for (const report of reports) {
          const expected = expectedOrder(
            created.filter((a) => a.workspaceId === ws && a.reportId === report),
          );
          const list1 = await repo.listAnnotations(ws, report);
          const list2 = await repo.listAnnotations(ws, report);

          // 2) Scope (Req 7.2): exactly this (workspace, report) pair's
          //    annotations, in createdAt-DESC/id-DESC order; nothing else.
          assert.deepStrictEqual(list1, expected, 'listAnnotations is not exactly the scoped, ordered set');

          // Explicit exclusion: every returned row belongs to this pair.
          for (const a of list1) {
            assert.equal(a.workspaceId, ws, 'leaked another workspace\'s annotation');
            assert.equal(a.reportId, report, 'leaked another report\'s annotation');
          }

          // 3) Adjacent-pair ordering invariant: createdAt non-increasing, ties
          //    broken by id DESC (ids are unique).
          for (let k = 0; k + 1 < list1.length; k++) {
            const cur = list1[k]!;
            const next = list1[k + 1]!;
            assert.ok(cur.createdAt >= next.createdAt, 'createdAt must be non-increasing');
            if (cur.createdAt === next.createdAt) {
              assert.ok(cur.id > next.id, 'equal-createdAt ties must break by id DESC');
            }
          }

          // Repeated calls on identical state are byte-for-byte equal.
          assert.equal(JSON.stringify(list1), JSON.stringify(list2), 'repeated list calls diverge');
        }
      }
    }),
    { numRuns: 100 },
  );
});
