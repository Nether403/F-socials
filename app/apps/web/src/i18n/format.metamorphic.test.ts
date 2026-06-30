// Feature: en-nl-localization, Property 8: Format presentation-only (metamorphic) with invalid-input fallback
// Validates: Requirements 6.4, 6.6

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatDate, formatNumber } from './format';

/**
 * Property 8: Format presentation-only (metamorphic) with invalid-input fallback
 *
 * For any valid date or number, the Locale_Formatter output under English and
 * under Dutch represents the same underlying value and differs only in presentation;
 * for any value that is not a valid date or number, the Locale_Formatter returns the
 * value's original unformatted representation unchanged.
 */

/**
 * Parse a locale-formatted number back to its numeric value using Intl knowledge.
 * en-US: grouping = ',', decimal = '.'   (e.g. -1,000.5)
 * nl-NL: grouping = '.', decimal = ','   (e.g. -1.000,5)
 */
function parseEnNumber(s: string): number {
  const stripped = s.replace(/\u00A0/g, '').replace(/\s/g, '').replace(/,/g, '');
  return Number(stripped);
}
function parseNlNumber(s: string): number {
  const stripped = s.replace(/\u00A0/g, '').replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
  return Number(stripped);
}

describe('formatNumber — Property 8: presentation-only metamorphic', () => {
  it('en and nl outputs represent the same underlying integer value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const enResult = formatNumber(n, 'en');
        const nlResult = formatNumber(n, 'nl');

        // Both produce non-empty strings
        expect(enResult.length).toBeGreaterThan(0);
        expect(nlResult.length).toBeGreaterThan(0);

        // Both parse back to the same value
        expect(parseEnNumber(enResult)).toBe(n);
        expect(parseNlNumber(nlResult)).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('en and nl outputs represent the same underlying double value', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const enResult = formatNumber(n, 'en');
          const nlResult = formatNumber(n, 'nl');

          // Both produce non-empty strings
          expect(enResult.length).toBeGreaterThan(0);
          expect(nlResult.length).toBeGreaterThan(0);

          // Both locale representations parse back to the same value as each other
          // (Intl.NumberFormat may round, but both locales round identically)
          const enParsed = parseEnNumber(enResult);
          const nlParsed = parseNlNumber(nlResult);
          expect(enParsed).toBeCloseTo(nlParsed, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('NaN passes through unchanged', () => {
    expect(formatNumber(NaN, 'en')).toBe('NaN');
    expect(formatNumber(NaN, 'nl')).toBe('NaN');
  });

  it('Infinity passes through unchanged', () => {
    expect(formatNumber(Infinity, 'en')).toBe('Infinity');
    expect(formatNumber(-Infinity, 'en')).toBe('-Infinity');
    expect(formatNumber(Infinity, 'nl')).toBe('Infinity');
    expect(formatNumber(-Infinity, 'nl')).toBe('-Infinity');
  });
});

describe('formatDate — Property 8: presentation-only metamorphic', () => {
  it('en and nl outputs represent the same underlying date value', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('1970-01-01'), max: new Date('2099-12-31') }), (d) => {
        // ponytail: fc.date can produce invalid dates in edge cases; skip them here
        // (invalid-date passthrough is tested separately below)
        fc.pre(!isNaN(d.getTime()));

        const enResult = formatDate(d, 'en');
        const nlResult = formatDate(d, 'nl');

        // Both produce non-empty strings
        expect(enResult.length).toBeGreaterThan(0);
        expect(nlResult.length).toBeGreaterThan(0);

        // Both should parse back to the same date (same day)
        const enDate = new Date(enResult);
        const nlParts = nlResult.split('-');

        // At minimum, both formatted outputs contain the same day, month, year components
        // Extract numeric components from both strings
        const enDigits = enResult.replace(/[^\d]/g, ' ').trim().split(/\s+/).map(Number);
        const nlDigits = nlResult.replace(/[^\d]/g, ' ').trim().split(/\s+/).map(Number);

        // The set of numeric components should be the same (day, month, year)
        // regardless of order (en = M/D/YYYY, nl = D-M-YYYY)
        const expectedDay = d.getDate();
        const expectedMonth = d.getMonth() + 1;
        const expectedYear = d.getFullYear();

        expect(enDigits).toContain(expectedDay);
        expect(enDigits).toContain(expectedMonth);
        expect(enDigits).toContain(expectedYear);
        expect(nlDigits).toContain(expectedDay);
        expect(nlDigits).toContain(expectedMonth);
        expect(nlDigits).toContain(expectedYear);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid date string passes through unchanged', () => {
    expect(formatDate('not-a-date', 'en')).toBe('not-a-date');
    expect(formatDate('not-a-date', 'nl')).toBe('not-a-date');
    expect(formatDate('garbage!!', 'en')).toBe('garbage!!');
    expect(formatDate('garbage!!', 'nl')).toBe('garbage!!');
  });
});
