// Feature: expert-review-queue, Property 6: Resolution drives item and report status
// Validates: Requirements 4.1, 4.5, 5.1, 5.2, 12.2
//
// For any report with one or more Review_Items:
//   - recording a Review_Resolution on a pending (or in_review) item persists
//     the outcome, optional note, resolving reviewer, and a resolution
//     timestamp, and sets that item's status to 'resolved' — no prior claim
//     required (Req 4.1);
//   - recording a SECOND resolution on an already-resolved item REPLACES the
//     prior resolution, keeps status 'resolved', and creates NO duplicate item
//     (the queue length is unchanged) (Req 4.5);
//   - the derived Report_Review_Status (deriveReportReviewStatus over the
//     report's item statuses) is 'under-dispute' while any sibling Review_Item
//     for the report remains pending/in_review (Req 5.1), and becomes
//     'expert-reviewed' exactly once EVERY Review_Item for the report is
//     'resolved' (Req 5.2).
//
// Scenario: several pending items that share ONE reportId are seeded, then
// resolved one at a time. After each resolution the resolved item, its
// persisted resolution fields on the stored repo row, and the derived report
// status are all asserted; finally an already-resolved item is re-resolved to
// exercise the replace-on-repeat / no-duplicate branch.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { pendingReviewRowArb, seedRepository } from './review.arb';
import { RESOLUTION_OUTCOMES } from '../src/core/reviewOutcome';
import { deriveReportReviewStatus } from '../src/core/reportReviewStatus';
import type { ReviewKind, ReviewResolutionInput } from '../src/types';

// The existing report value the derivation overlays onto — irrelevant once the
// report has at least one item (only used for the empty case), but realistic.
const BASE_STATUS = 'ai-generated' as const;

const reviewerArb = fc.constantFrom('reviewer-1', 'reviewer-2', 'reviewer-3');
const outcomeArb = fc.constantFrom(...RESOLUTION_OUTCOMES);

// A Review_Resolution submission: outcome + resolving reviewer, with note
// present only some of the time (so the "optional note" branch is exercised).
const resolutionInputArb: fc.Arbitrary<ReviewResolutionInput> = fc
  .record({
    outcome: outcomeArb,
    reviewer: reviewerArb,
    note: fc.option(fc.string({ unit: 'grapheme' }), { nil: undefined }),
  })
  .map((r) => {
    const input: ReviewResolutionInput = { outcome: r.outcome, reviewer: r.reviewer };
    if (r.note !== undefined) input.note = r.note;
    return input;
  });

// One scenario: 1..5 fresh pending items (mixed dispute/flag) that will be
// forced to share a single reportId, each paired with the resolution to record
// on it, plus a second resolution to re-apply on an already-resolved item.
const scenarioArb = fc.record({
  reportId: fc.constantFrom('report-a', 'report-b', 'report-c'),
  entries: fc.array(
    fc.record({ tagged: pendingReviewRowArb, resolution: resolutionInputArb }),
    { minLength: 1, maxLength: 5 },
  ),
  reResolution: resolutionInputArb,
});

// Find the live stored row (carrying the persisted `resolution`) on the repo's
// public disputes/flags arrays (Req: read resolution via repo.disputes/flags).
function storedRow(repo: ReturnType<typeof seedRepository>, kind: ReviewKind, sourceId: string) {
  const arr = kind === 'dispute' ? repo.disputes : repo.flags;
  return arr.find((r) => r.id === sourceId);
}

test('Property 6: resolution sets item resolved + drives report status, replace-on-repeat keeps one item', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ reportId, entries, reResolution }) => {
      // Force every generated item onto ONE shared reportId and give each a
      // unique, kind-scoped source id so the Review_Item ids never collide and
      // the queue length is deterministic.
      const items = entries.map((e, i) => ({
        kind: e.tagged.kind,
        row: { ...e.tagged.row, reportId, id: `item-${i}` },
        resolution: e.resolution,
      }));

      const repo = seedRepository({
        disputes: items.filter((it) => it.kind === 'dispute').map((it) => it.row) as never,
        flags: items.filter((it) => it.kind === 'flag').map((it) => it.row) as never,
      });

      const total = items.length;
      assert.equal((await repo.listReviewItems()).length, total, 'seeded one Review_Item per row');

      // Resolve one at a time; assert per-item resolution + derived report status.
      for (let i = 0; i < total; i++) {
        const { kind, row, resolution } = items[i]!;
        const id = `${kind}:${row.id}`;

        const result = await repo.recordReviewResolution(id, resolution);
        assert.ok(result.ok, 'recording a resolution on a pending item must succeed (no prior claim)');
        assert.equal(result.ok && result.item.status, 'resolved', 'resolved item status must be "resolved"');

        // Persisted resolution fields on the stored repo row (Req 4.1).
        const stored = storedRow(repo, kind, row.id);
        assert.ok(stored, 'the resolved row must still exist on the repo');
        assert.equal(stored!.reviewStatus, 'resolved', 'stored row status must be resolved');
        assert.ok(stored!.resolution !== null, 'stored row must carry a resolution');
        assert.equal(stored!.resolution!.outcome, resolution.outcome, 'persisted outcome must match submission');
        assert.equal(stored!.resolution!.reviewer, resolution.reviewer, 'persisted resolving reviewer must match');
        assert.ok(
          typeof stored!.resolution!.resolvedAt === 'string' && !Number.isNaN(Date.parse(stored!.resolution!.resolvedAt)),
          'a parseable resolution timestamp must be persisted',
        );
        if (resolution.note !== undefined) {
          assert.equal(stored!.resolution!.note, resolution.note, 'persisted note must match when provided');
        } else {
          assert.equal(stored!.resolution!.note, undefined, 'no note persisted when none submitted');
        }

        // No duplicate / no omission — the queue length never changes.
        assert.equal((await repo.listReviewItems()).length, total, 'queue length unchanged after a resolution');

        // Derived report status over the report's item statuses (Req 5.1, 5.2).
        const siblingStatuses = (await repo.listReviewItems())
          .filter((it) => it.reportId === reportId)
          .map((it) => it.status);
        const derived = deriveReportReviewStatus(BASE_STATUS, siblingStatuses);
        if (i < total - 1) {
          assert.equal(derived, 'under-dispute', 'report stays under-dispute while a sibling is unresolved');
        } else {
          assert.equal(derived, 'expert-reviewed', 'report becomes expert-reviewed once every item is resolved');
        }
      }

      // Replace-on-repeat: re-resolve an already-resolved item. Status stays
      // resolved, the prior resolution is replaced by the new submission, and
      // NO duplicate item is created (queue length unchanged) (Req 4.5).
      const first = items[0]!;
      const firstId = `${first.kind}:${first.row.id}`;
      const reResult = await repo.recordReviewResolution(firstId, reResolution);
      assert.ok(reResult.ok, 're-resolving an already-resolved item must succeed');
      assert.equal(reResult.ok && reResult.item.status, 'resolved', 're-resolved item stays resolved');

      const reStored = storedRow(repo, first.kind, first.row.id);
      assert.ok(reStored && reStored.resolution !== null, 're-resolved row must still carry a resolution');
      assert.equal(reStored!.resolution!.outcome, reResolution.outcome, 'prior outcome replaced by the new submission');
      assert.equal(reStored!.resolution!.reviewer, reResolution.reviewer, 'prior reviewer replaced by the new submission');
      if (reResolution.note !== undefined) {
        assert.equal(reStored!.resolution!.note, reResolution.note, 'replaced note matches the new submission');
      } else {
        assert.equal(reStored!.resolution!.note, undefined, 'replaced resolution carries no note when none submitted');
      }

      assert.equal((await repo.listReviewItems()).length, total, 'no duplicate item created by re-resolution');

      // All items resolved → report remains expert-reviewed after the replace.
      const finalStatuses = (await repo.listReviewItems())
        .filter((it) => it.reportId === reportId)
        .map((it) => it.status);
      assert.equal(
        deriveReportReviewStatus(BASE_STATUS, finalStatuses),
        'expert-reviewed',
        'report stays expert-reviewed after a replace-on-repeat resolution',
      );
    }),
    { numRuns: 100 },
  );
});
