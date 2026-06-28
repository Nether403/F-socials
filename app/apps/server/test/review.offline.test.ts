// Feature: expert-review-queue — offline-first path example tests (task 4.10).
//
// The zero-API-key / zero-DB path must stay operable: a bare InMemoryRepository
// services every review method without throwing, and the additive review fields
// are readable through the existing public disputes/flags accessors — the same
// way the offline path reads any persisted state.
// _Requirements: 6.3, 6.4, 6.8_

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';

// ── Req 6.3 / 6.8: every review method runs on a bare repo without throwing ──
test('every review method runs on a zero-config InMemoryRepository without throwing (Req 6.3, 6.8)', async () => {
  // Zero config, zero keys, no DB connection.
  const repo = new InMemoryRepository();

  // listReviewItems on an empty repo: returns [], never throws (Req 6.8).
  assert.deepEqual(await repo.listReviewItems(), []);

  // Seed one of each via the public intake methods (no DB involved).
  await repo.createDispute({
    id: 'd1',
    reportId: 'report-a',
    reason: 'misleading framing',
    createdAt: '2024-01-01T08:00:00.000Z',
  });
  await repo.createFlag({
    id: 'f1',
    reportId: 'report-b',
    userId: 'user-1',
    technique: 'cherry-picking',
    createdAt: '2024-01-01T08:00:00.000Z',
  });

  // Each method returns a discriminated result (an object with `ok`), never throws.
  const claim = await repo.claimReviewItem('dispute:d1', 'reviewer-1');
  assert.equal(typeof claim.ok, 'boolean');

  const release = await repo.releaseReviewItem('dispute:d1', 'reviewer-1');
  assert.equal(typeof release.ok, 'boolean');

  const resolve = await repo.recordReviewResolution('flag:f1', {
    outcome: 'no_change_needed',
    reviewer: 'reviewer-1',
  });
  assert.equal(typeof resolve.ok, 'boolean');

  // And the list now projects both seeded rows.
  const items = await repo.listReviewItems();
  assert.equal(items.length, 2);
});

// ── Req 6.4: review fields are readable via the public accessors ───────────
test('review fields are readable on a fresh dispute via repo.disputes accessor (Req 6.4)', async () => {
  const repo = new InMemoryRepository();
  await repo.createDispute({
    id: 'd1',
    reportId: 'report-a',
    reason: 'misleading framing',
    createdAt: '2024-01-01T08:00:00.000Z',
  });

  assert.equal(repo.disputes.length, 1);
  assert.equal(repo.disputes[0]!.reviewStatus, 'pending');
  assert.equal(repo.disputes[0]!.assignedReviewer, null);
  assert.equal(repo.disputes[0]!.resolution, null);
});

test('review fields are readable on a fresh flag via repo.flags accessor (Req 6.4)', async () => {
  const repo = new InMemoryRepository();
  await repo.createFlag({
    id: 'f1',
    reportId: 'report-b',
    userId: 'user-1',
    technique: 'cherry-picking',
    createdAt: '2024-01-01T08:00:00.000Z',
  });

  assert.equal(repo.flags.length, 1);
  assert.equal(repo.flags[0]!.reviewStatus, 'pending');
  assert.equal(repo.flags[0]!.assignedReviewer, null);
  assert.equal(repo.flags[0]!.resolution, null);
});
