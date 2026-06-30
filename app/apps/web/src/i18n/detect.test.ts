// Feature: en-nl-localization, Property 2: Detection totality and priority
// Validates: Requirements 2.2, 2.3, 2.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectLanguage } from './detect';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, isSupportedLanguage } from './catalog';

/**
 * Property 2: Detection totality and priority
 *
 * For any arbitrary list of browser-reported language preferences,
 * the Locale_Detector returns a Supported_Language — the highest-priority
 * preference whose primary subtag matches `en` or `nl` case-insensitively
 * (regardless of region tag), and the Default_Language when no preference matches.
 */

const primarySubtags = ['en', 'nl', 'fr', 'de', 'zh', 'es', 'ja', 'pt', 'ar', 'ko', 'it', 'ru'];
const regionSuffixes = ['', '-US', '-BE', '-NL', '-GB', '-DE', '-FR', '-AU', '-CA'];

/** Generate a language tag: random primary subtag + optional region, random casing */
const arbLanguageTag = fc.tuple(
  fc.constantFrom(...primarySubtags),
  fc.constantFrom(...regionSuffixes),
  fc.constantFrom('lower', 'upper', 'mixed') as fc.Arbitrary<'lower' | 'upper' | 'mixed'>,
).map(([primary, region, casing]) => {
  const tag = primary + region;
  switch (casing) {
    case 'upper': return tag.toUpperCase();
    case 'mixed': return tag.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join('');
    default: return tag;
  }
});

/** Generate a preference list (0–10 tags) */
const arbPreferenceList = fc.array(arbLanguageTag, { minLength: 0, maxLength: 10 });

describe('detectLanguage — Property 2: Detection totality and priority', () => {
  it('always returns a Supported_Language', () => {
    fc.assert(
      fc.property(arbPreferenceList, (prefs) => {
        const result = detectLanguage(prefs);
        expect(isSupportedLanguage(result)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('returns DEFAULT_LANGUAGE for an empty preference list', () => {
    expect(detectLanguage([])).toBe(DEFAULT_LANGUAGE);
  });

  it('returns the highest-priority supported match', () => {
    fc.assert(
      fc.property(arbPreferenceList, (prefs) => {
        const result = detectLanguage(prefs);
        // Find the expected: first pref whose primary subtag (lowercase) is supported
        const expected = prefs.reduce<typeof result | null>((found, tag) => {
          if (found !== null) return found;
          const primary = tag.split('-')[0].toLowerCase();
          return isSupportedLanguage(primary) ? primary : null;
        }, null) ?? DEFAULT_LANGUAGE;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('matching is case-insensitive on the primary subtag', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        fc.constantFrom(...regionSuffixes),
        fc.constantFrom('lower', 'upper', 'mixed') as fc.Arbitrary<'lower' | 'upper' | 'mixed'>,
        (lang, region, casing) => {
          let tag = lang + region;
          switch (casing) {
            case 'upper': tag = tag.toUpperCase(); break;
            case 'mixed': tag = tag.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join(''); break;
          }
          // A supported language tag (any casing/region) as the only preference should match
          const result = detectLanguage([tag]);
          expect(result).toBe(lang);
        },
      ),
      { numRuns: 100 },
    );
  });
});
