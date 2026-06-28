// Feature: expert-review-queue — edge/rejection-branch example tests (task 4.10).
//
// Covers the rejection branches of the four InMemoryRepository review methods
// that the property suite (4.4–4.9) exercises only incidentally: claim on a
// resolved item, claim/release/resolve on unknown and malformed ids, release on
// an item the caller does not hold, the empty-list boundary, claim contention,
// and resolution on a never-claimed pending item.
//
// Plain node:test + node:assert example tests (no fast-check) — these are the
// "this exact branch returns this exact result" checks.
// _Requirements: 2.7, 2.8, 3.3, 3.6, 3.8, 4.4, 6.7, 6.8_

import test from 'node:test';
import assert from 'node:assert/strict';

import { seedRepository, type DisputeReviewRow, type FlagReviewRow } from './review.arb';
import { InMemoryRepository } from '../src/infra/memory';

// Minimal row builders (same shape createDispute/createFlag store). Overrides
// let each test set the review state it needs.
function disputeRow(over: Partial<DisputeReviewRow> = {}): DisputeReviewRow {
  return {
    id: 'd1',
    reportId: 'report-a',
    reason: 'misleading framing',
    createdAt: '2024-01-01T08:00:00.000Z',
    reviewStatus: 'pending',
    assignedReviewer: null,
    resolution: null,
    ...over,
  };
}
function flagRow(over: Partial<FlagReviewRow> = {}): FlagReviewRow {
  return {
    id: 'f1',
    reportId: 'report-b',
    userId: 'user-1',
    technique: 'cherry-picking',
    createdAt: '2024-01-01T08:00:00.000Z',
    reviewStatus: 'pending',
    assignedReviewer: null,
    resolution: null,
    ...over,
  };
}

// A valid resolution payload for recordReviewResolution.
const resolution = { outcome: 'no_change_needed' as const, reviewer: 'reviewer-1' };

// ── Req 3.3: claim on a resolved item → conflict ──────────────────────────
test('claim on a resolved item is rejected as conflict (Req 3.3)', async () => {
  const repo = seedRepository({
    disputes: [
      disputeRow({
        reviewStatus: 'resolved',
        assignedReviewer: 'reviewer-1',
        resolution: { outcome: 'no_change_needed', reviewer: 'reviewer-1', resolvedAt: '2024-01-02T08:00:00.000Z' },
      }),
    ],
  });
  const result = await repo.claimReviewItem('dispute:d1', 'reviewer-2');
  assert.deepEqual(result, { ok: false, reason: 'conflict' });
  // State unchanged: still resolved, still assigned to the original reviewer.
  assert.equal(repo.disputes[0]!.reviewStatus, 'resolved');
  assert.equal(repo.disputes[0]!.assignedReviewer, 'reviewer-1');
});

// ── Req 3.6 / 4.4: unknown & malformed ids → not_found across all methods ──
const UNKNOWN_IDS = [
  'dispute:does-not-exist', // well-formed but no such row
  'flag:does-not-exist',
  'bogus', // no separator
  'dispute:', // empty sourceId
  'nope:123', // unknown kind
];

for (const id of UNKNOWN_IDS) {
  test(`claim/release/resolve on unknown/malformed id "${id}" → not_found, no state change (Req 3.6, 4.4)`, async () => {
    const repo = seedRepository({ disputes: [disputeRow()], flags: [flagRow()] });

    const claim = await repo.claimReviewItem(id, 'reviewer-1');
    const release = await repo.releaseReviewItem(id, 'reviewer-1');
    const resolve = await repo.recordReviewResolution(id, resolution);

    assert.deepEqual(claim, { ok: false, reason: 'not_found' }, 'claim');
    assert.deepEqual(release, { ok: false, reason: 'not_found' }, 'release');
    assert.deepEqual(resolve, { ok: false, reason: 'not_found' }, 'resolve');

    // The seeded rows are untouched.
    assert.equal(repo.disputes[0]!.reviewStatus, 'pending');
    assert.equal(repo.flags[0]!.reviewStatus, 'pending');
    assert.equal(repo.disputes[0]!.resolution, null);
  });
}

// ── Req 3.8 / 6.7: release on an item not held by the caller → not_actionable ──
test('release on a pending (unheld) item → not_actionable (Req 3.8, 6.7)', async () => {
  const repo = seedRepository({ disputes: [disputeRow()] });
  const result = await repo.releaseReviewItem('dispute:d1', 'reviewer-1');
  assert.deepEqual(result, { ok: false, reason: 'not_actionable' });
  assert.equal(repo.disputes[0]!.reviewStatus, 'pending');
  assert.equal(repo.disputes[0]!.assignedReviewer, null);
});

test('release on an item held by another reviewer → not_actionable, state unchanged (Req 3.8, 6.7)', async () => {
  const repo = seedRepository({
    flags: [flagRow({ reviewStatus: 'in_review', assignedReviewer: 'reviewer-1' })],
  });
  const result = await repo.releaseReviewItem('flag:f1', 'reviewer-2');
  assert.deepEqual(result, { ok: false, reason: 'not_actionable' });
  // Still held by reviewer-1, still in_review.
  assert.equal(repo.flags[0]!.reviewStatus, 'in_review');
  assert.equal(repo.flags[0]!.assignedReviewer, 'reviewer-1');
});

// ── Req 2.8 / 6.8: listReviewItems on an empty repo → [] ───────────────────
test('listReviewItems on an empty repo returns [] (Req 2.8, 6.8)', async () => {
  const repo = new InMemoryRepository();
  assert.deepEqual(await repo.listReviewItems(), []);
  // A status filter that matches nothing also returns [].
  assert.deepEqual(await repo.listReviewItems({ status: 'resolved' }), []);
});

// ── Req 3.2: claim held-by-another → conflict ─────────────────────────────
test('claim on an item already held by another reviewer → conflict, holder unchanged (Req 3.2)', async () => {
  const repo = seedRepository({
    disputes: [disputeRow({ reviewStatus: 'in_review', assignedReviewer: 'reviewer-1' })],
  });
  const result = await repo.claimReviewItem('dispute:d1', 'reviewer-2');
  assert.deepEqual(result, { ok: false, reason: 'conflict' });
  assert.equal(repo.disputes[0]!.assignedReviewer, 'reviewer-1');
  assert.equal(repo.disputes[0]!.reviewStatus, 'in_review');
});

// ── Req 4.1: resolution does NOT require a prior claim — sanity that
// not_actionable is a release-only concern (resolve on pending succeeds). ──
test('resolution on a pending item (no prior claim) succeeds and sets resolved (Req 4.1)', async () => {
  const repo = seedRepository({ disputes: [disputeRow()] });
  const result = await repo.recordReviewResolution('dispute:d1', resolution);
  assert.equal(result.ok, true);
  assert.equal(repo.disputes[0]!.reviewStatus, 'resolved');
  assert.ok(repo.disputes[0]!.resolution !== null);
  assert.equal(repo.disputes[0]!.resolution!.outcome, 'no_change_needed');
  assert.equal(repo.disputes[0]!.resolution!.reviewer, 'reviewer-1');
});
