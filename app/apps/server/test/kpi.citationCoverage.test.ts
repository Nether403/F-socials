// Feature: observability-instrumentation, Property 9: Citation_Coverage is bounded,
// total, and classifies correctly.
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8.
//
// For any list of per-claim audits — including the empty list and audits carrying an
// out-of-enum Evidence_Outcome — citationCoverage returns a finite real in [0,1] equal
// to |Cited_Outcome claims| / |claims carrying one of the six defined outcomes|, where
// the three Honest_None outcomes count toward the denominator only, an empty list
// yields exactly 0, an out-of-enum outcome is excluded from both numerator and
// denominator, and the input audits are left unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { citationCoverage, CITED_OUTCOMES, HONEST_NONE_OUTCOMES } from '../src/core/kpi';
import type { AuditRecord, EvidenceOutcome } from '../src/types';

const CITED = [...CITED_OUTCOMES];
const HONEST_NONE = [...HONEST_NONE_OUTCOMES];

// The six defined outcomes plus out-of-enum strings (typed as EvidenceOutcome to
// model the "outcome outside the six defined values" case from Req 7.8).
const outcomeArb = fc.oneof(
  fc.constantFrom(...CITED),
  fc.constantFrom(...HONEST_NONE),
  // out-of-enum: arbitrary labels that are not one of the six, incl. empty string.
  fc
    .string()
    .filter((s) => !CITED.includes(s as EvidenceOutcome) && !HONEST_NONE.includes(s as EvidenceOutcome))
    .map((s) => s as EvidenceOutcome),
);

const auditArb: fc.Arbitrary<Pick<AuditRecord, 'evidenceOutcome'>> = outcomeArb.map(
  (evidenceOutcome) => ({ evidenceOutcome }),
);

// Independent oracle: count cited and defined-outcome claims directly.
function expected(audits: ReadonlyArray<Pick<AuditRecord, 'evidenceOutcome'>>): number {
  let cited = 0;
  let defined = 0;
  for (const { evidenceOutcome } of audits) {
    if (CITED_OUTCOMES.has(evidenceOutcome)) {
      cited++;
      defined++;
    } else if (HONEST_NONE_OUTCOMES.has(evidenceOutcome)) {
      defined++;
    }
  }
  return defined === 0 ? 0 : cited / defined;
}

test('Property 9: citationCoverage is a finite real in [0,1]', () => {
  fc.assert(
    fc.property(fc.array(auditArb), (audits) => {
      const cov = citationCoverage(audits);
      assert.ok(Number.isFinite(cov), `coverage must be finite, got ${cov}`);
      assert.ok(cov >= 0 && cov <= 1, `coverage must be in [0,1], got ${cov}`);
    }),
    { numRuns: 200 },
  );
});

test('Property 9: equals |cited| / |defined| with honest-none in the denominator only, out-of-enum excluded', () => {
  fc.assert(
    fc.property(fc.array(auditArb), (audits) => {
      assert.equal(citationCoverage(audits), expected(audits));
    }),
    { numRuns: 200 },
  );
});

test('Property 9: empty list yields exactly 0 (valid honest-none)', () => {
  assert.equal(citationCoverage([]), 0);
});

test('Property 9: a list with only out-of-enum outcomes yields exactly 0 (excluded from both)', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc
          .string()
          .filter(
            (s) => !CITED.includes(s as EvidenceOutcome) && !HONEST_NONE.includes(s as EvidenceOutcome),
          )
          .map((s) => ({ evidenceOutcome: s as EvidenceOutcome })),
        { minLength: 1 },
      ),
      (audits) => {
        assert.equal(citationCoverage(audits), 0);
      },
    ),
    { numRuns: 200 },
  );
});

test('Property 9: input audits are left unchanged (deep-equal before and after)', () => {
  fc.assert(
    fc.property(fc.array(auditArb), (audits) => {
      const snapshot = structuredClone(audits);
      citationCoverage(audits);
      assert.deepEqual(audits, snapshot);
    }),
    { numRuns: 200 },
  );
});
