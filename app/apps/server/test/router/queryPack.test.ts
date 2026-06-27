// Feature: claim-verification-router, Property 4: Query packs are well-formed
// For any checkable canonical claim, the generated Query_Pack contains the four
// required Query_Variant kinds (exact_normalized, compressed_entity_predicate,
// fact_check_style, counterclaim_negated), contains no more than six variants,
// has a valid kind on every variant, and derives its exact_normalized variant
// from the Canonical_Claim.
// Validates: Requirements 2.1, 2.2, 2.4, 2.5

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { QueryPackGenerator } from '../../src/router/queryPack';
import type { QueryVariantKind } from '../../src/types';

const REQUIRED_KINDS: QueryVariantKind[] = [
  'exact_normalized',
  'compressed_entity_predicate',
  'fact_check_style',
  'counterclaim_negated',
];

const VALID_KINDS = new Set<QueryVariantKind>([
  ...REQUIRED_KINDS,
  'source_language',
  'english',
]);

// Canonical claims are normalized, non-empty, checkable restatements. The generator
// mixes realistic word-based claims with strings carrying punctuation, mixed case,
// and surrounding whitespace to exercise compression/negation/derivation edge cases,
// while filtering out claims that are empty after trimming (the normalizer never
// emits those upstream).
const claimArb = fc
  .oneof(
    fc.lorem({ maxCount: 12 }),
    fc
      .array(
        fc.constantFrom('Earth', 'is', 'flat', 'vaccines', 'cause', 'autism', 'the', 'GDP', 'rose', '3%', 'in', '2023', 'NASA', 'confirmed', 'water', 'on', 'Mars'),
        { minLength: 1, maxLength: 10 },
      )
      .map((w) => w.join(' ')),
    fc.string({ minLength: 1, maxLength: 80 }),
  )
  .map((s) => `  ${s}  `) // pad to verify exact_normalized derivation trims
  .filter((s) => s.trim().length > 0);

// Language hints: English locales (no extra variants) plus non-English (adds two).
const langHintArb = fc.option(
  fc.constantFrom('en', 'en-US', 'EN', 'nl', 'fr', 'de', 'nl-NL', 'es', 'ja'),
  { nil: undefined },
);

test('Property 4: query packs are well-formed', () => {
  fc.assert(
    fc.property(claimArb, langHintArb, (rawClaim, langHint) => {
      const pack = QueryPackGenerator.generate(rawClaim, langHint);

      // 2.2: no more than six variants.
      assert.ok(pack.length <= 6, `pack exceeded six variants: ${pack.length}`);

      // 2.4: every variant has a valid kind and a non-empty text.
      for (const v of pack) {
        assert.ok(VALID_KINDS.has(v.kind), `invalid variant kind: ${v.kind}`);
        assert.equal(typeof v.text, 'string');
        assert.ok(v.text.length > 0, 'variant text must be non-empty');
      }

      // 2.1: the four required kinds are all present.
      const kinds = new Set(pack.map((v) => v.kind));
      for (const required of REQUIRED_KINDS) {
        assert.ok(kinds.has(required), `missing required kind: ${required}`);
      }

      // 2.5: exact_normalized is derived from the Canonical_Claim (the trimmed claim verbatim).
      const exact = pack.filter((v) => v.kind === 'exact_normalized');
      assert.equal(exact.length, 1, 'exactly one exact_normalized variant expected');
      assert.equal(exact[0]?.text, rawClaim.trim());
    }),
    { numRuns: 100 },
  );
});

// Feature: claim-verification-router, Property 5: Non-English topics get a source-language and an English variant
// For any checkable claim carrying a non-English language hint, the generated
// Query_Pack contains at least one source_language variant and at least one
// english variant.
// Validates: Requirements 2.3

// Non-English language hints only. queryPack.isNonEnglish treats any hint that is
// present and not an English locale (not matching /^en(-|$)/i) as non-English, so
// these all trigger the source_language + english variant pair.
const nonEnglishHintArb = fc.constantFrom('nl', 'fr', 'de', 'es', 'ja', 'nl-NL', 'fr-FR', 'de-DE', 'ja-JP');

test('Property 5: non-English topics get a source-language and an English variant', () => {
  fc.assert(
    fc.property(claimArb, nonEnglishHintArb, (rawClaim, langHint) => {
      const pack = QueryPackGenerator.generate(rawClaim, langHint);

      const sourceLanguage = pack.filter((v) => v.kind === 'source_language');
      const english = pack.filter((v) => v.kind === 'english');

      // 2.3: at least one source-language variant and at least one English variant.
      assert.ok(
        sourceLanguage.length >= 1,
        `expected a source_language variant for hint "${langHint}"`,
      );
      assert.ok(
        english.length >= 1,
        `expected an english variant for hint "${langHint}"`,
      );
    }),
    { numRuns: 100 },
  );
});
