// Feature: en-nl-localization, Property 1: Resolution totality with fallback
// Validates: Requirements 1.7, 2.6, 2.7, 2.8, 4.6, 5.6, 8.9, 9.5, 11.6

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolve, fill, translate } from './resolve';
import { en } from './en';
import type { Language, MessageCatalog } from './catalog';

const SUPPORTED_LANGUAGES: Language[] = ['en', 'nl'];
const knownKeys = Object.keys(en);

// Build catalogs: en is real, nl mirrors en for this test (nl.ts may not exist yet)
const catalogs: Record<Language, MessageCatalog> = {
  en: en as unknown as MessageCatalog,
  nl: en as unknown as MessageCatalog, // same shape; property only cares about non-emptiness
};

describe('Property 1: Resolution totality with fallback', () => {
  it('resolve always returns a non-empty string for known keys × any language', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownKeys),
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (key, lang) => {
          const result = resolve(key, lang, catalogs);
          expect(result.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolve always returns a non-empty string for unknown/arbitrary keys × any language', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (key, lang) => {
          const result = resolve(key, lang, catalogs);
          expect(result.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolve returns non-empty even for completely empty/whitespace keys', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', ' ', '  ', '\t', '\n'),
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (key, lang) => {
          const result = resolve(key, lang, catalogs);
          expect(result.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolve falls through whitespace-only catalog values to produce non-empty output', () => {
    const whitespaceArb = fc.constantFrom(' ', '  ', '\t', '\n', '   \n  ');

    fc.assert(
      fc.property(
        fc.constantFrom(...knownKeys),
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        whitespaceArb,
        (key, lang, whitespace) => {
          // Build catalogs where both languages have whitespace-only for this key
          const poisoned: Record<Language, MessageCatalog> = {
            en: { ...catalogs.en, [key]: whitespace },
            nl: { ...catalogs.nl, [key]: whitespace },
          };
          const result = resolve(key, lang, poisoned);
          expect(result.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('translate always returns a non-empty string (resolve + fill combined)', () => {
    const valuesArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.oneof(fc.string({ minLength: 1 }), fc.integer().map(String)),
    );

    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...knownKeys), fc.string({ minLength: 1 })),
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        valuesArb,
        (key, lang, values) => {
          const result = translate(key, lang, catalogs, values);
          expect(result.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
