// Feature: expert-review-queue, Property 1: Queue projection fidelity
// Validates: Requirements 2.1, 2.2, 2.3, 4.6, 8.2, 8.4
//
// For any set of persisted Disputes and Flags, listReviewItems() returns exactly
// one Review_Item per source row (no duplicate, no omission), and on each item
// every projected field equals the originating row's value:
//   - reportId, kind, status (from reviewStatus), createdAt,
//   - assignedReviewer (null when unassigned, Req 2.2),
//   - a dispute-derived item carries `reason` and carries `claimId` only when the
//     Dispute has one, and NO submitter-identity field of any kind,
//   - a flag-derived item carries `technique` and carries `note` only when the
//     Flag has one, and NO submitter identity (the flag's userId must NOT appear).
// Every item id "{kind}:{sourceId}" resolves to exactly one originating row
// (Req 4.6). A Review_Item exposes ONLY the allowed projection keys — checked by
// iterating the item's keys against the allowed set, so any future submitter-
// identity leak (e.g. userId) fails the test (Req 8.2). Finally, every item built
// from a freshly created intake has status 'pending' (Req 8.4), exercised through
// createDispute/createFlag which default to pending.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import {
  reviewRowsArb,
  seedRepository,
  type DisputeReviewRow,
  type FlagReviewRow,
} from './review.arb';

// The complete set of keys a projected Review_Item may carry. Anything outside
// this set — most importantly any submitter-identity field such as `userId` —
// is a neutrality/privacy leak and must fail the test (Req 8.2).
const ALLOWED_KEYS = new Set([
  'id',
  'kind',
  'reportId',
  'status',
  'assignedReviewer',
  'createdAt',
  'reason',
  'claimId',
  'technique',
  'note',
]);

// Split a Review_Item id "{kind}:{sourceId}" at the first ':' (a uuid carries no
// colon, so the source id is everything after it).
function parseId(id: string): { kind: string; sourceId: string } {
  const i = id.indexOf(':');
  return { kind: id.slice(0, i), sourceId: id.slice(i + 1) };
}

test('Property 1: queue projection fidelity — one item per row, fields equal source, no submitter identity', async () => {
  await fc.assert(
    fc.asyncProperty(reviewRowsArb, async (rows) => {
      const repo = seedRepository(rows);
      const items = await repo.listReviewItems();

      // Exactly one Review_Item per source row: no omission, no duplicate.
      assert.equal(
        items.length,
        rows.disputes.length + rows.flags.length,
        'one Review_Item per persisted Dispute and Flag',
      );
      const ids = new Set(items.map((it) => it.id));
      assert.equal(ids.size, items.length, 'every Review_Item id is unique (no duplicate)');

      // Index source rows by id for one-to-one id resolution (Req 4.6).
      const disputeById = new Map<string, DisputeReviewRow>(rows.disputes.map((d) => [d.id, d]));
      const flagById = new Map<string, FlagReviewRow>(rows.flags.map((f) => [f.id, f]));

      for (const item of items) {
        // Every key the item exposes must be an allowed projection key — this is
        // how "no submitter identity of any kind" is enforced structurally.
        for (const key of Object.keys(item)) {
          assert.ok(ALLOWED_KEYS.has(key), `Review_Item exposes a non-projected key "${key}"`);
        }

        const { kind, sourceId } = parseId(item.id);
        assert.equal(kind, item.kind, 'id-encoded kind matches the item kind');

        // Fields common to both kinds.
        if (kind === 'dispute') {
          const row = disputeById.get(sourceId);
          // The id resolves to exactly one originating Dispute (Req 4.6).
          assert.ok(row, `dispute item id ${item.id} resolves to a source dispute row`);

          assert.equal(item.reportId, row.reportId, 'reportId equals source');
          assert.equal(item.status, row.reviewStatus, 'status equals source reviewStatus');
          assert.equal(item.createdAt, row.createdAt, 'createdAt equals source');
          assert.equal(item.assignedReviewer, row.assignedReviewer, 'assignedReviewer equals source (null when unassigned)');

          // Dispute-derived payload (Req 2.3).
          assert.equal(item.reason, row.reason, 'dispute reason equals source');
          if (row.claimId !== undefined) {
            assert.equal(item.claimId, row.claimId, 'claimId equals source when the dispute carries one');
          } else {
            assert.ok(!('claimId' in item), 'claimId absent when the dispute carries none');
          }
          // A dispute item never carries flag-only fields.
          assert.ok(!('technique' in item), 'dispute item carries no technique');
          assert.ok(!('note' in item), 'dispute item carries no note');
        } else {
          assert.equal(kind, 'flag', 'item kind is dispute or flag');
          const row = flagById.get(sourceId);
          // The id resolves to exactly one originating Flag (Req 4.6).
          assert.ok(row, `flag item id ${item.id} resolves to a source flag row`);

          assert.equal(item.reportId, row.reportId, 'reportId equals source');
          assert.equal(item.status, row.reviewStatus, 'status equals source reviewStatus');
          assert.equal(item.createdAt, row.createdAt, 'createdAt equals source');
          assert.equal(item.assignedReviewer, row.assignedReviewer, 'assignedReviewer equals source (null when unassigned)');

          // Flag-derived payload (Req 2.3).
          assert.equal(item.technique, row.technique, 'flag technique equals source');
          if (row.note !== undefined) {
            assert.equal(item.note, row.note, 'note equals source when the flag carries one');
          } else {
            assert.ok(!('note' in item), 'note absent when the flag carries none');
          }
          // The flag's submitter identity must NOT appear anywhere on the item (Req 8.2).
          assert.ok(!('userId' in item), 'flag item carries no submitter identity (userId)');
          // A flag item never carries dispute-only fields.
          assert.ok(!('reason' in item), 'flag item carries no reason');
          assert.ok(!('claimId' in item), 'flag item carries no claimId');
        }
      }
    }),
    { numRuns: 100 },
  );
});

// Fresh-intake branch (Req 8.4): items built from createDispute/createFlag, which
// default to pending, are projected with status 'pending'.
const freshDisputeArb = fc.record({
  id: fc.uuid(),
  reportId: fc.constantFrom('report-a', 'report-b', 'report-c'),
  claimId: fc.option(fc.uuid(), { nil: undefined }),
  reason: fc.string({ unit: 'grapheme' }),
  createdAt: fc.constantFrom('2024-01-01T08:00:00.000Z', '2024-02-15T12:30:00.000Z'),
});
const freshFlagArb = fc.record({
  id: fc.uuid(),
  reportId: fc.constantFrom('report-a', 'report-b', 'report-c'),
  userId: fc.uuid(),
  technique: fc.string({ unit: 'grapheme' }),
  note: fc.option(fc.string({ unit: 'grapheme' }), { nil: undefined }),
  createdAt: fc.constantFrom('2024-01-01T08:00:00.000Z', '2024-02-15T12:30:00.000Z'),
});

test('Property 1: a freshly created intake projects to a pending Review_Item (Req 8.4)', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(freshDisputeArb, { maxLength: 5 }),
      fc.array(freshFlagArb, { maxLength: 5 }),
      async (disputes, flags) => {
        const repo = new InMemoryRepository();
        for (const d of disputes) await repo.createDispute(d);
        for (const f of flags) await repo.createFlag(f);

        const items = await repo.listReviewItems();
        // createFlag dedupes on (reportId, userId, technique); count items, don't
        // assume a 1:1 with the flag input. Every projected item must be pending.
        for (const item of items) {
          assert.equal(item.status, 'pending', 'a freshly created intake is a pending Review_Item');
          assert.equal(item.assignedReviewer, null, 'a fresh intake is unassigned');
        }
        // At least the disputes (no dedupe) must surface as pending items.
        assert.ok(items.length >= disputes.length, 'every created dispute surfaces as a Review_Item');
      },
    ),
    { numRuns: 100 },
  );
});
