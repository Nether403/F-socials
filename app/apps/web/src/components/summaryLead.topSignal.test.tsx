// Feature: progressive-disclosure-report-ui, Property 1: Most-important framing signal is the highest-severity, earliest-on-tie signal
// Validates: Requirements 1.2, 1.3
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { topFramingSignal } from './reportView';
import type { FramingSignal } from '../api/types';

// Severity rank scale taken verbatim from Report.tsx's SEVERITY_RANK — do not guess.
const SEVERITY_RANK: Record<FramingSignal['severity'], number> = { high: 3, medium: 2, low: 1 };

const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

const framingSignal = fc.record({
  technique: nonBlank,
  severity: fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.constant([] as FramingSignal['examples']),
});

// Independent reference: the lowest index whose rank equals the maximum rank in the array.
function expectedTop(signals: FramingSignal[]): FramingSignal {
  const maxRank = Math.max(...signals.map((s) => SEVERITY_RANK[s.severity]));
  return signals[signals.findIndex((s) => SEVERITY_RANK[s.severity] === maxRank)];
}

describe('Property 1: Most-important framing signal is the highest-severity, earliest-on-tie signal', () => {
  it('returns the max-severity signal, breaking ties by first report-order index', () => {
    fc.assert(
      fc.property(fc.array(framingSignal, { minLength: 1 }), (signals) => {
        const result = topFramingSignal(signals)!;
        const expected = expectedTop(signals);
        // Identity: must be the exact element at the expected index, not just an equal-ranked one.
        expect(result).toBe(expected);
        expect(SEVERITY_RANK[result.severity]).toBe(
          Math.max(...signals.map((s) => SEVERITY_RANK[s.severity])),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('returns undefined for an empty array', () => {
    expect(topFramingSignal([])).toBeUndefined();
  });
});
