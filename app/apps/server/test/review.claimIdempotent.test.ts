// Feature: expert-review-queue, Property 3: Claim idempotence
// Validates: Requirements 3.1, 3.4, 12.1
//
// For any pending Review_Item and any Reviewer, claiming it one OR MORE times
// in succession yields the same result as claiming it exactly once:
//   - assignedReviewer equals the claiming Reviewer,
//   - status equals 'in_review',
// with no further state change on the second and subsequent claims (Req 3.4).
// The very first claim is the grant that sets in_review (Req 3.1); every later
// claim by the same reviewer is a no-op success returning the identical item,
// and the repo's stored row equals the single-claim result.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { pendingReviewRowArb, seedRepository } from './review.arb';
import type { ReviewItem } from '../src/types';

// A reviewer pool drawn alongside the item, so the property holds for any
// claiming reviewer (Req 3.1, 3.4).
const reviewerArb = fc.constantFrom('reviewer-1', 'reviewer-2', 'reviewer-3', 'reviewer-x');
// Random repeat count in [1, 5] — one claim or several, the outcome is identical.
const claimCountArb = fc.integer({ min: 1, max: 5 });

test('Property 3: claiming a pending item one or more times is idempotent', async () => {
  await fc.assert(
    fc.asyncProperty(
      pendingReviewRowArb,
      reviewerArb,
      claimCountArb,
      async ({ kind, row }, reviewer, claimCount) => {
        // Build the Review_Item id "{kind}:{sourceId}" and seed the repo on the
        // matching table for this kind.
        const id = `${kind}:${row.id}`;
        const repo =
          kind === 'dispute'
            ? seedRepository({ disputes: [row as never] })
            : seedRepository({ flags: [row as never] });

        // Claim once: the grant. Establishes the reference result every later
        // claim must match (Req 3.1).
        const first = await repo.claimReviewItem(id, reviewer);
        assert.ok(first.ok, 'the first claim on a pending item must succeed');
        const firstItem = first.item;
        assert.equal(firstItem.assignedReviewer, reviewer, 'first claim assigns the claiming reviewer');
        assert.equal(firstItem.status, 'in_review', 'first claim sets status to in_review');

        // Claim again (claimCount - 1) more times: each is an idempotent no-op
        // success returning the identical item state (Req 3.4).
        for (let i = 1; i < claimCount; i++) {
          const again = await repo.claimReviewItem(id, reviewer);
          assert.ok(again.ok, `claim #${i + 1} by the same reviewer must succeed (idempotent)`);
          assert.equal(again.item.assignedReviewer, reviewer, `claim #${i + 1} keeps the same assignee`);
          assert.equal(again.item.status, 'in_review', `claim #${i + 1} keeps status in_review`);
          // Deep-equal to the single-claim result: no further state change.
          assert.deepEqual(again.item, firstItem, `claim #${i + 1} yields the same item as a single claim`);
        }

        // The repo's stored row, projected via the queue, equals the
        // single-claim result — no extra mutation accumulated across claims.
        const queue = await repo.listReviewItems();
        const stored: ReviewItem | undefined = queue.find((it) => it.id === id);
        assert.ok(stored, 'the claimed item must still be present in the queue');
        assert.equal(stored.assignedReviewer, reviewer, 'stored row is assigned to the claiming reviewer');
        assert.equal(stored.status, 'in_review', 'stored row status is in_review');
        assert.deepEqual(stored, firstItem, 'stored row equals the single-claim result');
      },
    ),
    { numRuns: 100 },
  );
});
