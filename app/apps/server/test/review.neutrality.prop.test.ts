// Feature: expert-review-queue, Property 9: Neutrality is enforced and the outcome vocabulary is framing/evidence-only
// Validates: Requirements 9.3, 9.6, 12.5
//
// f-Socials is a lens, not a judge. A Resolution_Outcome may describe the report's
// FRAMING or EVIDENCE only — never a creator/channel/author and never a truthfulness
// verdict (Req 9.3). This property pins two guarantees:
//   1. Every value the schema would ACCEPT as a Resolution_Outcome belongs to the
//      approved framing/evidence-only set and carries none of the banned
//      creator-reliability / truthfulness-verdict tokens; the schema REJECTS any
//      string outside that set.
//   2. The Neutrality_Check (a small surface scanner mirroring reportGraph's stance)
//      PASSES on a clean review surface and FAILS the moment a banned dimension is
//      injected (Req 9.6) — so the standard test run breaks if neutrality regresses
//      (Req 12.5).
// The broader static scan over migration SQL / route fields / console labels is task 11.2.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { RESOLUTION_OUTCOMES } from '../src/core/reviewOutcome';
import { reviewResolutionSchema } from '../src/http/validation';

// Banned tokens: any creator-reliability rating or truthfulness verdict. Mirrors the
// reportGraph neutrality stance. Matched as case-insensitive substrings so snake_case
// labels (`creator_reliability`) and word fragments (`credib`ility, `trustworth`y) are
// all caught.
const BANNED = [
  'true',
  'false',
  'accurate',
  'inaccurate',
  'misinformation',
  'disinformation',
  'reliable',
  'unreliable',
  'credib',
  'trustworth',
  'liar',
  'fake',
  'creator',
  'channel',
  'author',
  'person',
] as const;

// Neutrality_Check: a review surface (a set of vocabulary values / field names /
// console-label strings) is neutral iff no string contains any banned token.
function neutralityCheck(surface: readonly string[]): boolean {
  return surface.every((s) => {
    const lower = s.toLowerCase();
    return !BANNED.some((token) => lower.includes(token));
  });
}

// --- Vocabulary is framing/evidence-only -----------------------------------------

test('Property 9: every Resolution_Outcome value is in the approved set and carries no banned token', () => {
  assert.ok(RESOLUTION_OUTCOMES.length > 0, 'outcome vocabulary must be non-empty');
  for (const outcome of RESOLUTION_OUTCOMES) {
    assert.ok(
      neutralityCheck([outcome]),
      `Resolution_Outcome "${outcome}" contains a banned creator-reliability/truthfulness token`,
    );
  }
});

test('Property 9: the schema accepts only framing/evidence-only outcomes (≥100 runs)', () => {
  const approved = new Set<string>(RESOLUTION_OUTCOMES);

  fc.assert(
    fc.property(
      // Mix the real vocabulary with arbitrary strings so the schema's accept/reject
      // boundary is exercised against both members and non-members.
      fc.oneof(fc.constantFrom(...RESOLUTION_OUTCOMES), fc.string()),
      (candidate) => {
        const parsed = reviewResolutionSchema.safeParse({ outcome: candidate });
        if (parsed.success) {
          // Anything ACCEPTED must be an approved framing/evidence-only value that
          // matches no creator-reliability or truthfulness-verdict token.
          assert.ok(
            approved.has(parsed.data.outcome),
            `schema accepted a non-approved outcome: "${candidate}"`,
          );
          assert.ok(
            neutralityCheck([parsed.data.outcome]),
            `schema accepted an outcome containing a banned token: "${candidate}"`,
          );
        } else {
          // Anything REJECTED must genuinely be outside the approved set.
          assert.ok(
            !approved.has(candidate),
            `schema rejected an approved outcome: "${candidate}"`,
          );
        }
      },
    ),
    { numRuns: 200 },
  );
});

// --- Neutrality_Check passes clean, fails on injection ----------------------------

test('Property 9: Neutrality_Check passes a clean surface and fails when a banned dimension is injected (≥100 runs)', () => {
  fc.assert(
    fc.property(
      // A clean candidate surface drawn from the real, neutral vocabulary.
      fc.array(fc.constantFrom(...RESOLUTION_OUTCOMES), { minLength: 1, maxLength: 7 }),
      // A banned dimension and the affixes used to embed it (mimicking how it might
      // sneak into a column name / route field / label, e.g. "is_<token>_rating").
      fc.constantFrom(...BANNED),
      fc.string(),
      fc.string(),
      (cleanSurface, bannedToken, prefix, suffix) => {
        // A surface made only of approved vocabulary is neutral → passes.
        assert.ok(
          neutralityCheck(cleanSurface),
          `clean surface unexpectedly failed Neutrality_Check: ${cleanSurface.join(', ')}`,
        );

        // Inject a banned dimension anywhere in the surface → must fail.
        const injected = `${prefix}${bannedToken}${suffix}`;
        const tainted = [...cleanSurface, injected];
        assert.ok(
          !neutralityCheck(tainted),
          `Neutrality_Check passed a surface containing the banned token "${bannedToken}" (injected as "${injected}")`,
        );
      },
    ),
    { numRuns: 200 },
  );
});
