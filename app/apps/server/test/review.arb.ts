// Shared fast-check arbitrary for the expert-review-queue property suite.
// Feature: expert-review-queue — generators (task 4.3).
//
// Produces random Disputes and Flags carrying review-workflow state, in the
// exact row shape the InMemoryRepository stores (mirrors memory.ts:
// `DisputeRow & ReviewFields` / `FlagRow & ReviewFields`, which themselves
// mirror Migration_005's additive columns). These feed the property tests in
// tasks 4.4–4.9 (projection fidelity, list ordering, claim idempotence/
// exclusivity, release round-trip, resolution → status).
//
// Generated review state is internally COHERENT — the only states the repo can
// reach — so a downstream test never has to special-case an impossible row:
//   pending   -> assignedReviewer null,    resolution null
//   in_review -> assignedReviewer present, resolution null
//   resolved  -> assignedReviewer present, resolution present (note optional)
//
// Timestamp ties are deliberately common: `createdAt` is drawn from a small
// pool and `reportId` from a separate small pool, so multiple rows routinely
// share a `createdAt` while differing on `reportId` — exactly the input the
// list-ordering tie-break by reportId (Req 2.6, task 4.5) needs to exercise.
//
// This file is a generator, not a test — it carries no `node:test` cases. The
// guarded self-check at the bottom (run via `node --import tsx test/review.arb.ts`)
// asserts the data invariants and that ties actually occur in a sample.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { RESOLUTION_OUTCOMES } from '../src/core/reviewOutcome';
import type { ResolutionOutcome, ReviewKind, ReviewLifecycle } from '../src/types';

// ── Row shapes (mirror memory.ts's private DisputeRow/FlagRow + ReviewFields) ──
type ReviewFields = {
  reviewStatus: ReviewLifecycle;
  assignedReviewer: string | null;
  resolution: { outcome: ResolutionOutcome; note?: string; reviewer: string; resolvedAt: string } | null;
};
export type DisputeReviewRow = {
  id: string;
  reportId: string;
  claimId?: string;
  reason: string;
  createdAt: string;
} & ReviewFields;
export type FlagReviewRow = {
  id: string;
  reportId: string;
  userId: string;
  technique: string;
  note?: string;
  createdAt: string;
} & ReviewFields;

export type ReviewRows = { disputes: DisputeReviewRow[]; flags: FlagReviewRow[] };

// ── Building-block arbitraries ────────────────────────────────────────────
// Full-unicode text (emoji, CJK, combining marks), possibly empty — exercises
// the messy free-text reason/technique/note the intake can carry.
const text = fc.string({ unit: 'grapheme' });
const optionalText = fc.option(text, { nil: undefined });

// Small pools so ties are common: many rows share a createdAt (drives the
// reportId tie-break) while reportId varies independently across rows.
const createdAtArb = fc.constantFrom(
  '2024-01-01T08:00:00.000Z',
  '2024-02-15T12:30:00.000Z',
  '2024-03-20T18:45:00.000Z',
);
const reportIdArb = fc.constantFrom('report-a', 'report-b', 'report-c');
// Small reviewer pool so claim/contention tests see same-vs-different reviewers.
const reviewerIdArb = fc.constantFrom('reviewer-1', 'reviewer-2', 'reviewer-3');

// A resolution payload in the stored shape: `note` omitted entirely when absent
// (matches recordReviewResolution's conditional spread in memory.ts).
const resolutionArb: fc.Arbitrary<NonNullable<ReviewFields['resolution']>> = fc
  .record({
    outcome: fc.constantFrom(...RESOLUTION_OUTCOMES),
    note: optionalText,
    reviewer: reviewerIdArb,
    resolvedAt: createdAtArb,
  })
  .map((r) => {
    const res: NonNullable<ReviewFields['resolution']> = {
      outcome: r.outcome,
      reviewer: r.reviewer,
      resolvedAt: r.resolvedAt,
    };
    if (r.note !== undefined) res.note = r.note;
    return res;
  });

// Coherent review state — only the three reachable shapes (see header).
const reviewFieldsArb: fc.Arbitrary<ReviewFields> = fc
  .constantFrom<ReviewLifecycle>('pending', 'in_review', 'resolved')
  .chain((status) => {
    if (status === 'pending') {
      return fc.constant<ReviewFields>({ reviewStatus: 'pending', assignedReviewer: null, resolution: null });
    }
    if (status === 'in_review') {
      return reviewerIdArb.map<ReviewFields>((reviewer) => ({
        reviewStatus: 'in_review',
        assignedReviewer: reviewer,
        resolution: null,
      }));
    }
    return resolutionArb.map<ReviewFields>((resolution) => ({
      reviewStatus: 'resolved',
      assignedReviewer: resolution.reviewer,
      resolution,
    }));
  });

// A fresh-intake review state: pending, unassigned, unresolved (Req 8.4) — what
// createDispute/createFlag set. Used by the claim/release/resolution tests.
const pendingFieldsArb: fc.Arbitrary<ReviewFields> = fc.constant({
  reviewStatus: 'pending',
  assignedReviewer: null,
  resolution: null,
});

// ── Row arbitraries ────────────────────────────────────────────────────────
function disputeRowFrom(fields: fc.Arbitrary<ReviewFields>): fc.Arbitrary<DisputeReviewRow> {
  return fc
    .record({
      id: fc.uuid(),
      reportId: reportIdArb,
      claimId: fc.option(fc.uuid(), { nil: undefined }),
      reason: text,
      createdAt: createdAtArb,
      review: fields,
    })
    .map((r) => {
      const row: DisputeReviewRow = {
        id: r.id,
        reportId: r.reportId,
        reason: r.reason,
        createdAt: r.createdAt,
        ...r.review,
      };
      if (r.claimId !== undefined) row.claimId = r.claimId; // only when present (Req 2.3)
      return row;
    });
}

function flagRowFrom(fields: fc.Arbitrary<ReviewFields>): fc.Arbitrary<FlagReviewRow> {
  return fc
    .record({
      id: fc.uuid(),
      reportId: reportIdArb,
      userId: fc.uuid(), // submitter identity — deliberately NOT projected (Req 8.2)
      technique: text,
      note: optionalText,
      createdAt: createdAtArb,
      review: fields,
    })
    .map((r) => {
      const row: FlagReviewRow = {
        id: r.id,
        reportId: r.reportId,
        userId: r.userId,
        technique: r.technique,
        createdAt: r.createdAt,
        ...r.review,
      };
      if (r.note !== undefined) row.note = r.note; // only when present (Req 2.3)
      return row;
    });
}

/** A dispute row carrying an arbitrary (coherent) review state. */
export const disputeRowArb: fc.Arbitrary<DisputeReviewRow> = disputeRowFrom(reviewFieldsArb);
/** A flag row carrying an arbitrary (coherent) review state. */
export const flagRowArb: fc.Arbitrary<FlagReviewRow> = flagRowFrom(reviewFieldsArb);

/**
 * A mixed set of disputes + flags for projection/list property tests. Bounded,
 * and including the empty case (minLength 0) so the empty-queue boundary is
 * sampled. Timestamp ties across the combined set are common by construction.
 */
export const reviewRowsArb: fc.Arbitrary<ReviewRows> = fc.record({
  disputes: fc.array(disputeRowArb, { maxLength: 6 }),
  flags: fc.array(flagRowArb, { maxLength: 6 }),
});

/**
 * A single fresh, pending Review_Item (tagged with its kind so a test can build
 * the `"{kind}:{sourceId}"` id), for the claim/release/resolution tests.
 */
export const pendingReviewRowArb: fc.Arbitrary<{ kind: ReviewKind; row: DisputeReviewRow | FlagReviewRow }> =
  fc.oneof(
    disputeRowFrom(pendingFieldsArb).map((row) => ({ kind: 'dispute' as const, row })),
    flagRowFrom(pendingFieldsArb).map((row) => ({ kind: 'flag' as const, row })),
  );

/**
 * Build an InMemoryRepository seeded with generated rows. The repo's public
 * `disputes`/`flags` arrays are the only persistence offline, so we push the
 * already-shaped rows directly (same shape createDispute/createFlag store),
 * preserving the generated review state verbatim.
 */
export function seedRepository(rows: { disputes?: DisputeReviewRow[]; flags?: FlagReviewRow[] }): InMemoryRepository {
  const repo = new InMemoryRepository();
  for (const d of rows.disputes ?? []) repo.disputes.push(d);
  for (const f of rows.flags ?? []) repo.flags.push(f);
  return repo;
}

// ── Guarded self-check (ponytail: one runnable check behind the generator) ──
// Runs only on direct invocation (`node --import tsx test/review.arb.ts`),
// never on import. Asserts the data invariants the downstream tests rely on and
// that timestamp ties actually occur — so a regression in the generators fails
// fast, ahead of the property suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const LIFECYCLES: ReviewLifecycle[] = ['pending', 'in_review', 'resolved'];

  function checkFields(f: ReviewFields, where: string): void {
    assert.ok(LIFECYCLES.includes(f.reviewStatus), `${where}: reviewStatus must be one of the three lifecycle values`);
    if (f.reviewStatus === 'pending') {
      assert.equal(f.assignedReviewer, null, `${where}: pending must be unassigned`);
      assert.equal(f.resolution, null, `${where}: pending must be unresolved`);
    } else if (f.reviewStatus === 'in_review') {
      assert.ok(typeof f.assignedReviewer === 'string' && f.assignedReviewer.length > 0, `${where}: in_review must be assigned`);
      assert.equal(f.resolution, null, `${where}: in_review must be unresolved`);
    } else {
      assert.ok(f.resolution !== null, `${where}: resolved must carry a resolution`);
      assert.ok(RESOLUTION_OUTCOMES.includes(f.resolution.outcome), `${where}: resolution.outcome must be in the approved set`);
      assert.ok(f.resolution.reviewer.length > 0, `${where}: resolution.reviewer must be non-empty`);
      assert.ok(!Number.isNaN(Date.parse(f.resolution.resolvedAt)), `${where}: resolution.resolvedAt must parse`);
    }
  }

  const sets = fc.sample(reviewRowsArb, 300);
  let tiesSeen = 0;
  for (const set of sets) {
    const all = [...set.disputes, ...set.flags];
    for (const row of all) checkFields(row, 'row');
    // A tie = two rows in the combined set sharing a createdAt.
    const seen = new Set<string>();
    let tied = false;
    for (const row of all) {
      if (seen.has(row.createdAt)) tied = true;
      seen.add(row.createdAt);
    }
    if (tied) tiesSeen++;
  }
  assert.ok(tiesSeen > 0, 'expected timestamp ties to occur in the sample (drives the reportId tie-break test)');

  // Fresh pending items: every sample is pending/unassigned/unresolved.
  for (const { row } of fc.sample(pendingReviewRowArb, 100)) {
    assert.equal(row.reviewStatus, 'pending', 'pendingReviewRowArb must yield a pending row');
    checkFields(row, 'pending row');
  }

  // seedRepository round-trips rows into a working repo: one Review_Item per
  // row, listed in createdAt-then-reportId order with no submitter identity leak.
  const seeded = fc.sample(reviewRowsArb, 1)[0]!;
  const repo = seedRepository(seeded);
  void repo.listReviewItems().then((items) => {
    assert.equal(items.length, seeded.disputes.length + seeded.flags.length, 'one Review_Item per seeded row');
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1]!;
      const b = items[i]!;
      const ordered = a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.reportId <= b.reportId);
      assert.ok(ordered, 'listReviewItems must be ordered by createdAt then reportId');
    }
    assert.ok(
      items.every((it) => !('userId' in it)),
      'no submitter identity (userId) may appear on a Review_Item',
    );
    console.log(
      `review.arb self-check OK — ${sets.length} row-sets checked, ties in ${tiesSeen}; seeded repo lists ${items.length} ordered items`,
    );
  });
}
