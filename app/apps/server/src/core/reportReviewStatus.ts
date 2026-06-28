// Report review status (Requirements 5.1, 5.2, 5.3, 5.5): a PURE, offline derivation
// of a report's review status from the lifecycle statuses of its review items.
//
// This function NEVER mutates a report, NEVER reads gate-relevant fields (claims,
// framing signals, citations, evidence strengths, confidence), and NEVER returns a
// value outside the three existing Provenance.reviewStatus values. The report read
// path overlays the derived value onto the OUTGOING response object only; the
// persisted report is never rewritten. Because no write path touches the report,
// the invariant gate in core/assemble.ts is preserved by construction (Req 10).

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { Provenance, ReviewLifecycle } from '../types';

export function deriveReportReviewStatus(
  current: Provenance['reviewStatus'], // existing value (e.g. 'ai-generated')
  itemStatuses: ReviewLifecycle[], // every review item for this report
): Provenance['reviewStatus'] {
  if (itemStatuses.length === 0) return current; // Req 5.5 — no items → unchanged
  if (itemStatuses.some((s) => s !== 'resolved')) return 'under-dispute'; // Req 5.1
  return 'expert-reviewed'; // Req 5.2 — non-empty and all resolved
}

// ponytail: one runnable self-check (run `node --import tsx src/core/reportReviewStatus.ts`).
// Full property coverage is task 3.3 (Property 7); this fails fast on the three branches.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // empty → unchanged current (Req 5.5)
  assert.equal(deriveReportReviewStatus('ai-generated', []), 'ai-generated');
  assert.equal(deriveReportReviewStatus('expert-reviewed', []), 'expert-reviewed');

  // any non-resolved → under-dispute (Req 5.1)
  assert.equal(deriveReportReviewStatus('ai-generated', ['pending']), 'under-dispute');
  assert.equal(deriveReportReviewStatus('ai-generated', ['resolved', 'in_review']), 'under-dispute');

  // non-empty and all resolved → expert-reviewed (Req 5.2)
  assert.equal(deriveReportReviewStatus('ai-generated', ['resolved']), 'expert-reviewed');
  assert.equal(deriveReportReviewStatus('ai-generated', ['resolved', 'resolved']), 'expert-reviewed');

  // eslint-disable-next-line no-console
  console.log('reportReviewStatus self-check passed: empty→current, mixed→under-dispute, all-resolved→expert-reviewed.');
}
