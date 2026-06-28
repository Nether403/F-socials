// Feature: expert-review-queue, Property 7: Report-review-status derivation is total and bounded
// Validates: Requirements 5.1, 5.2, 5.3, 5.5
//
// For any existing Provenance.reviewStatus value and any multiset of
// ReviewLifecycle statuses, deriveReportReviewStatus:
//   - returns the unchanged existing value when the multiset is empty (Req 5.5),
//   - returns 'under-dispute' when any element is not 'resolved' (Req 5.1),
//   - returns 'expert-reviewed' when non-empty and every element is 'resolved' (Req 5.2),
// and the result is ALWAYS one of the three existing values, never a new one (Req 5.3).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { deriveReportReviewStatus } from '../src/core/reportReviewStatus';
import type { Provenance, ReviewLifecycle } from '../src/types';

// The three existing report review-status values — the function must never
// return anything outside this set (Req 5.3).
const REPORT_STATUSES: Provenance['reviewStatus'][] = [
  'ai-generated',
  'expert-reviewed',
  'under-dispute',
];
const REPORT_STATUS_SET = new Set<string>(REPORT_STATUSES);

const reportStatusArb = fc.constantFrom<Provenance['reviewStatus']>(...REPORT_STATUSES);
const lifecycleArb = fc.constantFrom<ReviewLifecycle>('pending', 'in_review', 'resolved');
const itemStatusesArb = fc.array(lifecycleArb, { maxLength: 12 });

test('Property 7: report-review-status derivation is total and bounded', async () => {
  await fc.assert(
    fc.property(reportStatusArb, itemStatusesArb, (current, itemStatuses) => {
      const result = deriveReportReviewStatus(current, itemStatuses);

      // Bounded: result is ALWAYS one of the three existing values (Req 5.3).
      assert.ok(
        REPORT_STATUS_SET.has(result),
        `derived status "${result}" is not one of the three existing values`,
      );

      if (itemStatuses.length === 0) {
        // Empty → unchanged existing value (Req 5.5).
        assert.equal(result, current);
      } else if (itemStatuses.every((s) => s === 'resolved')) {
        // Non-empty and every element resolved → expert-reviewed (Req 5.2).
        assert.equal(result, 'expert-reviewed');
      } else {
        // Non-empty with any element !== 'resolved' → under-dispute (Req 5.1).
        assert.equal(result, 'under-dispute');
      }
    }),
    { numRuns: 100 },
  );
});
