// Feature: en-nl-localization, Property 5: Catalog parity and completeness
// Validates: Requirements 4.3, 9.1, 9.2, 9.3, 9.4, 9.6

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { en } from './en';
import { nl } from './nl';

const enKeys = Object.keys(en) as (keyof typeof en)[];
const nlKeys = Object.keys(nl) as (keyof typeof nl)[];
const allKeys = [...new Set([...enKeys, ...nlKeys])] as string[];

describe('Property 5: Catalog parity and completeness', () => {
  it('the key sets are identical (same length, no extra keys on either side)', () => {
    expect(enKeys.length).toBe(nlKeys.length);

    const enSet = new Set(enKeys as string[]);
    const nlSet = new Set(nlKeys as string[]);
    const missingInNl = enKeys.filter((k) => !nlSet.has(k as string));
    const extraInNl = nlKeys.filter((k) => !enSet.has(k as string));

    expect(missingInNl).toEqual([]);
    expect(extraInNl).toEqual([]);
  });

  it('for any key from the union of both catalogs, both en[key] and nl[key] exist and are non-empty non-whitespace strings', () => {
    fc.assert(
      fc.property(fc.constantFrom(...allKeys), (key) => {
        const enValue = (en as Record<string, string>)[key];
        const nlValue = (nl as Record<string, string>)[key];

        // Key exists in both catalogs
        expect(enValue).toBeDefined();
        expect(nlValue).toBeDefined();

        // Both values are non-empty, non-whitespace strings
        expect(typeof enValue).toBe('string');
        expect(typeof nlValue).toBe('string');
        expect(enValue.trim().length).toBeGreaterThan(0);
        expect(nlValue.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: Math.max(100, allKeys.length) },
    );
  });
});
