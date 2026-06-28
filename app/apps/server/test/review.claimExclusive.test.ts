// Feature: expert-review-queue, Property 4: Claim exclusivity under contention
// Validates: Requirements 3.2, 3.5, 6.6
//
// For any pending Review_Item and any set of two or more DISTINCT reviewers
// claiming it, exactly one claim succeeds (ok:true) and every other claim is
// rejected as a conflict (ok:false, reason:'conflict'); the item's final
// assignedReviewer is the single winning reviewer and its status is
// 'in_review', and each rejected claim leaves the existing assignment/status
// unchanged.
//
// The InMemoryRepository is atomic by construction — no `await` falls between
// the read and the write inside claimReviewItem — so concurrent contention is
// modelled by running the distinct reviewers' claims sequentially in a loop:
// the FIRST distinct reviewer to claim wins (pending -> in_review), and every
// later distinct reviewer hits an item already held by another -> conflict
// (Req 3.2). Exactly one winner across any contending set is Req 3.5 / 6.6.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { pendingReviewRowArb, seedRepository } from './review.arb';

// Distinct reviewer ids (2..N). uniqueArray guarantees distinctness so each
// claim after the winner is a different-holder conflict, never an idempotent
// re-claim by the same reviewer.
const distinctReviewersArb = fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 6 });

test('Property 4: claim exclusivity under contention — exactly one winner, rest conflict', async () => {
  await fc.assert(
    fc.asyncProperty(pendingReviewRowArb, distinctReviewersArb, async ({ kind, row }, reviewers) => {
      const repo =
        kind === 'dispute'
          ? seedRepository({ disputes: [row as never] })
          : seedRepository({ flags: [row as never] });
      const id = `${kind}:${row.id}`;

      let winners = 0;
      let winningReviewer: string | null = null;

      for (const reviewer of reviewers) {
        const result = await repo.claimReviewItem(id, reviewer);
        if (result.ok) {
          winners += 1;
          winningReviewer = reviewer;
          // The winning claim reports the item as in_review, assigned to it.
          assert.equal(result.item.status, 'in_review');
          assert.equal(result.item.assignedReviewer, reviewer);
        } else {
          // Every rejected claim is a conflict (Req 3.2).
          assert.equal(result.reason, 'conflict');
          // A rejected claim leaves the existing assignment/status unchanged:
          // the row still belongs to the winner, still in_review.
          const after = (await repo.listReviewItems())[0]!;
          assert.equal(after.status, 'in_review');
          assert.equal(after.assignedReviewer, winningReviewer);
        }
      }

      // Exactly one reviewer won, no matter how many contended (Req 3.5, 6.6).
      assert.equal(winners, 1);
      assert.ok(winningReviewer !== null);

      // Final item state: the single winner holds it, status in_review.
      const final = (await repo.listReviewItems())[0]!;
      assert.equal(final.status, 'in_review');
      assert.equal(final.assignedReviewer, winningReviewer);
    }),
    { numRuns: 100 },
  );
});
