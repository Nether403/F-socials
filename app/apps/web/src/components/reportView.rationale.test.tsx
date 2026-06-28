// Feature: progressive-disclosure-report-ui, Property 5: Claim rationale follows the evidence→source precedence and omits on absence
// Validates: Requirements 3.2, 3.3, 3.5
//
// For any claim, claimRationale(claim) returns:
//   - evidenceDescription when it has ≥1 non-whitespace char, else
//   - sourceBasis when that has ≥1 non-whitespace char, else
//   - undefined.
// And RationaleBlock renders no node (no placeholder) for an undefined/whitespace-only value.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { claimRationale } from './reportView';
import { RationaleBlock } from './RationaleBlock';
import type { Claim } from '../api/types';

afterEach(() => {
  cleanup();
});

// A field is independently absent, whitespace-only, or non-blank.
const nonBlankStr = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
const whitespaceStr = fc.constantFrom('', '   ', '\n\t', '\t \n ');
// fc.option(..., { nil: undefined }) folds in the "absent" case alongside the value arbs.
const fieldArb = fc.option(fc.oneof(nonBlankStr, whitespaceStr), { nil: undefined });

// Only the fields claimRationale reads matter; cast a minimal object as Claim.
const claimArb = fc.record({
  evidenceDescription: fieldArb,
  sourceBasis: fieldArb,
}).map((f) => f as Claim);

const isBlank = (s: string | undefined): boolean => !s || s.trim().length === 0;

describe('Property 5: claim rationale precedence and omission', () => {
  it('returns evidence→source by precedence, undefined on absence, and RationaleBlock omits the node', () => {
    fc.assert(
      fc.property(claimArb, (claim) => {
        const result = claimRationale(claim);
        const ev = claim.evidenceDescription;
        const sb = claim.sourceBasis;

        // Precedence: evidenceDescription wins when non-blank.
        if (!isBlank(ev)) {
          expect(result).toBe(ev);
        } else if (!isBlank(sb)) {
          // Falls back to sourceBasis when evidence is blank/absent but source is non-blank.
          expect(result).toBe(sb);
        } else {
          // Neither is non-blank → no rationale.
          expect(result).toBeUndefined();

          // And the block renders nothing — no placeholder node in the DOM.
          const { container } = render(
            <RationaleBlock label="Why this is here" text={result} />,
          );
          expect(container).toBeEmptyDOMElement();
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  });
});
