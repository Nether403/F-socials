// Feature: expert-review-queue, Property 2: List filter and ordering contract
// Validates: Requirements 2.4, 2.6
//
// For any set of persisted Disputes and Flags and any valid ReviewLifecycle
// filter ('pending' | 'in_review' | 'resolved'):
//   - listReviewItems({ status }) returns PRECISELY the items whose status
//     equals the filter — every match included, every non-match excluded —
//     matching the full unfiltered list filtered in JS (Req 2.4).
//   - the returned items, FILTERED and UNFILTERED, are ordered by createdAt
//     ascending with ties broken by reportId ascending, asserted for every
//     adjacent pair (the arb generates rows sharing a createdAt so the
//     reportId tie-break is genuinely exercised) (Req 2.6).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { reviewRowsArb, seedRepository } from './review.arb';
import type { ReviewItem, ReviewLifecycle } from '../src/types';

const lifecycleArb = fc.constantFrom<ReviewLifecycle>('pending', 'in_review', 'resolved');

// Asserts the createdAt-asc, reportId-asc ordering holds for every adjacent
// pair — including ties on createdAt, which the arb makes common (Req 2.6).
function assertOrdered(items: ReviewItem[], where: string): void {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!;
    const b = items[i]!;
    const ok =
      a.createdAt < b.createdAt ||
      (a.createdAt === b.createdAt && a.reportId <= b.reportId);
    assert.ok(
      ok,
      `${where}: pair ${i - 1}->${i} out of order ` +
        `(${a.createdAt}/${a.reportId} then ${b.createdAt}/${b.reportId})`,
    );
  }
}

test('Property 2: list filter and ordering contract', async () => {
  await fc.assert(
    fc.asyncProperty(reviewRowsArb, lifecycleArb, async (rows, status) => {
      const repo = seedRepository(rows);

      const all = await repo.listReviewItems();
      const filtered = await repo.listReviewItems({ status });

      // One Review_Item per persisted row (no duplicate, no omission).
      assert.equal(all.length, rows.disputes.length + rows.flags.length);

      // Filter contract (Req 2.4): the filtered result equals the full list
      // filtered in JS — every match included, every non-match excluded. Set
      // equality by id (ids are unique per source row) plus a count check
      // catches both spurious inclusions and silent omissions.
      const expected = all.filter((i) => i.status === status);
      assert.equal(filtered.length, expected.length);
      assert.deepEqual(
        new Set(filtered.map((i) => i.id)),
        new Set(expected.map((i) => i.id)),
      );
      // Every returned item actually carries the filter status; nothing else does is leaked.
      assert.ok(filtered.every((i) => i.status === status));

      // Ordering contract (Req 2.6): holds for BOTH the unfiltered and the
      // filtered lists, across every adjacent pair (ties included).
      assertOrdered(all, 'unfiltered');
      assertOrdered(filtered, `filtered[${status}]`);
    }),
    { numRuns: 100 },
  );
});
