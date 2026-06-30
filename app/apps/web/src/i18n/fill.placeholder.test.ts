// Feature: en-nl-localization, Property 6: Placeholder substitution round-trip
// Validates: Requirements 4.4, 4.8

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fill } from './resolve';

/**
 * Arbitrary: a non-empty identifier suitable for placeholder names (alphanumeric + underscore).
 */
const placeholderName = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/);

/**
 * Arbitrary: a non-empty string value to substitute (no braces to avoid confusion with tokens).
 */
const placeholderValue = fc.stringMatching(/^[^{}]{1,30}$/);

/**
 * Arbitrary: a template built from literal segments interleaved with {name} tokens.
 * Returns { template, names } where names is the array of placeholder identifiers used.
 */
const templateWithPlaceholders = fc
  .record({
    segments: fc.array(fc.stringMatching(/^[^{}]{1,20}$/), { minLength: 1, maxLength: 5 }),
    names: fc.array(placeholderName, { minLength: 1, maxLength: 5 }),
  })
  .map(({ segments, names }) => {
    // Interleave: segment0 {name0} segment1 {name1} ... segmentN
    let template = '';
    for (let i = 0; i < names.length; i++) {
      template += (segments[i] ?? '') + `{${names[i]}}`;
    }
    // Append trailing segment if available
    if (segments.length > names.length) {
      template += segments[names.length];
    }
    return { template, names };
  });

describe('Property 6: Placeholder substitution round-trip', () => {
  it('when all placeholders are supplied, no {token} remains and each value appears in output', () => {
    fc.assert(
      fc.property(
        templateWithPlaceholders,
        fc.func(placeholderValue),
        ({ template, names }, valueFn) => {
          // Build a values map with a distinct value for each placeholder
          const values: Record<string, string> = {};
          for (const name of names) {
            values[name] = valueFn(name);
          }

          const result = fill(template, values);

          // No remaining {token} for any supplied name
          for (const name of names) {
            expect(result).not.toContain(`{${name}}`);
          }

          // Each supplied value appears in the output
          for (const name of names) {
            expect(result).toContain(values[name]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when no values are supplied, all tokens remain visible and result is non-empty', () => {
    fc.assert(
      fc.property(templateWithPlaceholders, ({ template, names }) => {
        const result = fill(template);

        // Every token stays visible
        for (const name of names) {
          expect(result).toContain(`{${name}}`);
        }

        // Result is non-empty
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('when some placeholders have no supplied value, those tokens remain visible and the message is non-empty', () => {
    // Generate a template with at least 2 unique placeholder names
    const uniqueNamesTemplate = fc
      .record({
        segments: fc.array(fc.stringMatching(/^[^{}]{1,20}$/), { minLength: 1, maxLength: 5 }),
        names: fc.uniqueArray(placeholderName, { minLength: 2, maxLength: 5 }),
      })
      .map(({ segments, names }) => {
        let template = '';
        for (let i = 0; i < names.length; i++) {
          template += (segments[i] ?? '') + `{${names[i]}}`;
        }
        if (segments.length > names.length) {
          template += segments[names.length];
        }
        return { template, names };
      });

    fc.assert(
      fc.property(uniqueNamesTemplate, placeholderValue, ({ template, names }, value) => {
        // Supply values for only the first half of unique placeholder names
        const supplied = names.slice(0, Math.ceil(names.length / 2));
        const unsupplied = names.slice(Math.ceil(names.length / 2));

        const values: Record<string, string> = {};
        for (const name of supplied) {
          values[name] = value;
        }

        const result = fill(template, values);

        // Supplied placeholders are resolved (value appears)
        for (const name of supplied) {
          expect(result).not.toContain(`{${name}}`);
        }

        // Unsupplied placeholders remain visible
        for (const name of unsupplied) {
          expect(result).toContain(`{${name}}`);
        }

        // Result is always non-empty
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('with an empty values map, all tokens remain visible', () => {
    fc.assert(
      fc.property(templateWithPlaceholders, ({ template, names }) => {
        const result = fill(template, {});

        for (const name of names) {
          expect(result).toContain(`{${name}}`);
        }

        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('numeric values are substituted correctly', () => {
    fc.assert(
      fc.property(
        templateWithPlaceholders,
        fc.func(fc.integer({ min: -10000, max: 10000 })),
        ({ template, names }, numFn) => {
          const values: Record<string, number> = {};
          for (const name of names) {
            values[name] = numFn(name);
          }

          const result = fill(template, values);

          // No remaining {token} for supplied names
          for (const name of names) {
            expect(result).not.toContain(`{${name}}`);
          }

          // Each numeric value (as string) appears in the output
          for (const name of names) {
            expect(result).toContain(String(values[name]));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
