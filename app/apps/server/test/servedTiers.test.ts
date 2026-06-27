// Feature: trust-and-launch-bundle, Property 3: Every served citation carries a
// policy-assigned tier. For any extraction processed by the pipeline, every
// citation on every claim in the resulting report has a sourceTier that is a
// valid member of the tier set { tier1_primary, tier2_institutional,
// tier3_viewpoint, excluded } — and that tier is the one the policy assigns from
// the citation's URL, never whatever tier the provider guessed.
//
// Validates: Requirements 2.6

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { runPipeline } from '../src/pipeline/stages';
import { classifyCitationTier } from '../src/core/sourceTier';
import { passthroughTranscript, mockLLM, mockNormalizer, mockPerspective, mockValidator } from '../src/providers/mock';
import type { EvidenceProvider, Providers } from '../src/providers/types';
import type { Citation, RawInput, SourceTier } from '../src/types';

const TIER_SET = new Set<SourceTier>([
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
]);

// A fixed transcript with several sentences so mockLLM extracts >=1 claim.
const INPUT: RawInput = {
  sourceType: 'transcript',
  transcript:
    'Unemployment fell to 4 percent last year according to the report. ' +
    'Critics say the policy is a disaster. ' +
    'A 2023 study found a 12% rise in costs. ' +
    'Everyone agrees the situation is shocking. ' +
    'The data shows steady growth.',
};

// sourceUrls spanning every classification branch plus pure garbage, so the
// policy is forced to assign tiers across the whole set, not just one.
const sourceUrlArb = fc.oneof(
  fc.constantFrom(
    'https://www.bbc.co.uk/news/x', // press council -> tier2
    'https://example.gov/report', // institutional suffix -> tier2
    'https://nature.com/articles/y', // viewpoint (not seeded) -> tier3
    'https://ec.europa.eu/eurostat/data', // primary -> tier1
    'https://randomblog.example/post', // viewpoint -> tier3
    'not a url', // unresolvable -> excluded
    'localhost', // bare host -> excluded
    '', // empty -> excluded
  ),
  // arbitrary junk: most resolve to viewpoint/excluded, exercises the parser.
  fc.string(),
  fc.webUrl(),
);

// A provider-guessed tier that is deliberately allowed to be wrong/garbage —
// the pipeline must overwrite it with the policy's classification.
const citationArb: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: sourceUrlArb,
  sourceName: fc.string(),
  sourceTier: fc.constantFrom(...TIER_SET, 'bogus_tier_from_provider' as SourceTier),
  excerpt: fc.option(fc.string(), { nil: undefined }),
  supports: fc.constantFrom(true, false, null),
});

function stubProviders(citations: Citation[]): Providers {
  const evidence: EvidenceProvider = {
    async gather() {
      return { evidenceStrength: 'moderate', citations };
    },
  };
  return {
    transcript: passthroughTranscript,
    llm: mockLLM,
    evidence,
    perspective: mockPerspective,
    normalizer: mockNormalizer,
    validator: mockValidator,
  };
}

test('Property 3: every served citation carries a valid, policy-assigned tier', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(citationArb, { maxLength: 4 }), async (citations) => {
      const report = await runPipeline(INPUT, stubProviders(citations));
      for (const claim of report.claims) {
        for (const cit of claim.citations) {
          assert.ok(TIER_SET.has(cit.sourceTier), `tier not in set: ${cit.sourceTier}`);
          assert.equal(cit.sourceTier, classifyCitationTier(cit.sourceUrl));
        }
      }
    }),
    { numRuns: 100 },
  );
});
