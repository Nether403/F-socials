// Retrieval (router Stage 4) must submit every Query_Variant to the provider chain
// exactly once — no variant dropped, none submitted twice. The Candidate_Validator
// owns precision downstream, so retrieval's only contract here is faithful, exactly-
// once fan-out of each variant to each evidence source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRetrieve, type RetrievalSource } from '../../src/router/retrieve';
import type { EvidenceProvider } from '../../src/providers/types';
import type { QueryVariant, SourceTier } from '../../src/types';

// A spy evidence provider that records every text it was asked to gather() for, so we
// can count submissions per variant.
function spyProvider(name: string): { provider: EvidenceProvider; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      async gather(claimText: string) {
        calls.push(claimText);
        return {
          evidenceStrength: 'none' as const,
          citations: [
            {
              sourceUrl: `https://${name}.example/${encodeURIComponent(claimText)}`,
              sourceName: name,
              sourceTier: 'tier2_institutional' as SourceTier,
              supports: null,
            },
          ],
        };
      },
    },
  };
}

// classifyTier stub — retrieval's tier source is irrelevant to the submission count.
const classifyTier = (): SourceTier => 'tier2_institutional';

const pack: QueryVariant[] = [
  { text: 'exact normalized claim', kind: 'exact_normalized' },
  { text: 'entity predicate', kind: 'compressed_entity_predicate' },
  { text: 'fact check style', kind: 'fact_check_style' },
  { text: 'counterclaim negated', kind: 'counterclaim_negated' },
];

test('retrieval submits every Query_Variant to each provider exactly once', async () => {
  const a = spyProvider('a');
  const b = spyProvider('b');
  const sources: RetrievalSource[] = [
    { provider: a.provider, isFactCheck: true },
    { provider: b.provider, isFactCheck: false },
  ];
  const retrieve = makeRetrieve({ sources, classifyTier });

  // Drive the full pack through retrieval, exactly as the orchestration does.
  for (const variant of pack) {
    await retrieve(variant);
  }

  const expected = pack.map((v) => v.text);

  // Each provider saw every variant's text exactly once, in order, with no extras.
  assert.deepEqual(a.calls, expected);
  assert.deepEqual(b.calls, expected);

  // And exactly one submission per (variant, provider) pair — no duplicates, no drops.
  for (const text of expected) {
    assert.equal(a.calls.filter((c) => c === text).length, 1, `provider a submitted "${text}" once`);
    assert.equal(b.calls.filter((c) => c === text).length, 1, `provider b submitted "${text}" once`);
  }
});

test('a single-query retrieval submits that one variant exactly once', async () => {
  const a = spyProvider('a');
  const retrieve = makeRetrieve({
    sources: [{ provider: a.provider, isFactCheck: false }],
    classifyTier,
  });

  await retrieve({ text: 'lone query', kind: 'exact_normalized' });

  assert.deepEqual(a.calls, ['lone query']);
});

// Feature: claim-verification-router, Property 9: Source tier always comes from the policy
// Validates: Requirements 5.1
//
// For any Candidate produced by retrieval, its sourceTier equals
// classifyCitationTier(candidate.sourceUrl) — the trust-and-launch-bundle
// Source_Tier_Policy. The router computes no source-reliability rating of its own and
// never trusts a provider's self-reported tier. To make that override observable, the
// generated providers deliberately stamp a WRONG sourceTier on every citation; the
// property still holds only because retrieval recomputes the tier from the policy.

import fc from 'fast-check';
import { classifyCitationTier } from '../../src/core/sourceTier';
import type { Citation } from '../../src/types';

// All tiers except the policy's real verdict, so a provider's stamped tier can be
// chosen to differ from what the policy would compute — proving retrieval ignores it.
const ALL_TIERS: SourceTier[] = ['tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded'];

// A provider that returns the given citations verbatim, each carrying an intentionally
// mis-stamped sourceTier (the opposite of whatever the real policy would assign).
function citationsProvider(citations: Citation[]): EvidenceProvider {
  return {
    async gather() {
      return { evidenceStrength: 'strong' as const, citations };
    },
  };
}

test('Property 9: every Candidate.sourceTier comes from classifyCitationTier, not the provider', async () => {
  await fc.assert(
    fc.asyncProperty(
      // Arbitrary URL-ish strings (valid hosts, bare words, junk, empty) so the policy
      // exercises tier1/tier2/tier3/excluded outcomes across runs.
      fc.array(
        fc.record({
          sourceUrl: fc.oneof(
            fc.webUrl(),
            fc.domain().map((d) => `https://${d}/article`),
            fc.constantFrom(
              'https://www.bbc.co.uk/news/x',
              'https://example.gov/report',
              'https://some-blog.example/post',
              'not a url',
              '',
            ),
            fc.string(),
          ),
          sourceName: fc.string(),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      fc.constantFrom<QueryVariant['kind']>(
        'exact_normalized',
        'compressed_entity_predicate',
        'fact_check_style',
        'counterclaim_negated',
      ),
      async (rows, kind) => {
        // Build citations whose self-reported tier is deliberately NOT the policy's
        // answer, so a pass can only mean retrieval recomputed it.
        const citations: Citation[] = rows.map((r) => {
          const real = classifyCitationTier(r.sourceUrl);
          const wrong = ALL_TIERS.find((t) => t !== real) ?? 'tier3_viewpoint';
          return { sourceUrl: r.sourceUrl, sourceName: r.sourceName, sourceTier: wrong, supports: null };
        });

        const retrieve = makeRetrieve({
          sources: [{ provider: citationsProvider(citations), isFactCheck: false }],
          // The REAL policy is injected — Property 9 asserts identity with its output.
          classifyTier: classifyCitationTier,
          perVariantCap: 100, // don't let the cap hide any candidate
        });

        const candidates = await retrieve({ text: 'any claim', kind });

        for (const c of candidates) {
          assert.equal(
            c.sourceTier,
            classifyCitationTier(c.sourceUrl),
            `sourceTier for ${JSON.stringify(c.sourceUrl)} must equal the policy's verdict`,
          );
        }
      },
    ),
    { numRuns: 200 },
  );
});
