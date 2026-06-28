// Feature: expert-review-queue, Property 5: Claim/release round-trip
// Validates: Requirements 3.7
//
// For any pending Review_Item and any Reviewer, claiming it and then releasing
// it as that SAME reviewer restores the item to its original pending state:
// the claim succeeds (in_review, assigned to the claimer), the release
// succeeds, and the final listed/stored item has assignedReviewer === null and
// status === 'pending' — identical to the original fresh-intake state.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { pendingReviewRowArb, seedRepository } from './review.arb';

const reviewerArb = fc.constantFrom('reviewer-1', 'reviewer-2', 'reviewer-3');

test('Property 5: claim then release by the same reviewer restores the pending state', async () => {
  await fc.assert(
    fc.asyncProperty(pendingReviewRowArb, reviewerArb, async ({ kind, row }, reviewer) => {
      const id = `${kind}:${row.id}`;
      const repo = seedRepository(kind === 'dispute' ? { disputes: [row as never] } : { flags: [row as never] });

      // Claim succeeds: status becomes in_review, assigned to the claimer.
      const claim = await repo.claimReviewItem(id, reviewer);
      assert.equal(claim.ok, true, 'claim of a pending item must succeed');
      assert.ok(claim.ok && claim.item.status === 'in_review', 'claimed item must be in_review');
      assert.ok(claim.ok && claim.item.assignedReviewer === reviewer, 'claimed item must be assigned to the claimer');

      // Release by the same reviewer succeeds.
      const release = await repo.releaseReviewItem(id, reviewer);
      assert.equal(release.ok, true, 'release by the holding reviewer must succeed');

      // Final state — via the release result and via the listed/stored item —
      // is restored to the original pending state (Req 3.7).
      assert.ok(release.ok && release.item.assignedReviewer === null, 'released item must be unassigned');
      assert.ok(release.ok && release.item.status === 'pending', 'released item must be pending');

      const [listed] = await repo.listReviewItems();
      assert.ok(listed, 'the item must still be present after release');
      assert.equal(listed!.id, id, 'the round-tripped item must keep its identity');
      assert.equal(listed!.assignedReviewer, null, 'final stored item must have null assignedReviewer');
      assert.equal(listed!.status, 'pending', 'final stored item must be pending (identical to original)');
    }),
    { numRuns: 100 },
  );
});
