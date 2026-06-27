// Feature: claim-verification-router, Task 11.4: integration test for the pipeline
// with the router wired into Stage 3.
//
// Drives the real runPipeline (src/pipeline/stages.ts) end to end with seeded,
// deterministic provider mocks and asserts the three pipeline-level behaviors the
// router must guarantee once it is wired in:
//
//   - Honest no-evidence presentation: a checkable claim whose every candidate the
//     validator judges `irrelevant` resolves to `no_sufficient_evidence` and is served
//     with evidenceStrength 'none' and ZERO cited evidence (Req 7.1).
//   - Context routing: a `same_topic_different_claim` candidate is routed to
//     usefulContext (never the ledger) and a `background_context` candidate is routed
//     to a Context_Card (never the ledger), and neither is presented as a citation
//     (Req 7.2, 7.4).
//   - A single unmatched claim does not fail the report: the assembled report stays
//     servable (status is 'ready', never 'failed') even though one of its claims found
//     no evidence (Req 7.3).
//
// The mocks are fully deterministic: a fixed LLM that emits exactly the four claims
// under test, a custom ClaimNormalizer that marks every claim `checkable` (so each is
// actually searched), an EvidenceProvider that returns one claim-specific candidate
// keyed off a keyword that survives query-pack generation, and a CandidateValidator
// that assigns a fixed Match_Type per claim keyed off the ORIGINAL claim text. So the
// pipeline's router wiring — not an LLM — is what this test exercises.
//
// Validates: Requirements 7.1, 7.2, 7.3

import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, type PipelineResult } from '../../src/pipeline/stages';
import type { Providers } from '../../src/providers/types';
import type { RawInput } from '../../src/types';

// ── Claims under test ─────────────────────────────────────────────────────────
// Each carries a distinctive keyword (unemployment / berlin / population / growth)
// that survives every Query_Variant transform (verbatim, compressed, fact-check,
// negated), so the evidence mock can hand back a claim-specific candidate and the
// validator can pick a fixed Match_Type — both keyed off the same keyword.
const CLAIM_UNMATCHED = 'The national unemployment rate was 5 percent in 2020.';
const CLAIM_SAME_TOPIC = 'The Berlin Wall fell in 1989.';
const CLAIM_BACKGROUND = 'Country X has a population of 50 million people.';
const CLAIM_MATCHED = 'A government study reported 30 percent growth in 2021.';

// Claim-specific candidate URLs so routed regions can be correlated unambiguously.
const URL_UNMATCHED = 'https://news.unmatched.test/u';
const URL_SAME_TOPIC = 'https://history.sametopic.test/b';
const URL_BACKGROUND = 'https://data.background.test/p';
const URL_MATCHED = 'https://www.cdc.gov/growth-report'; // .gov => non-excluded tier

function buildProviders(): Providers {
  return {
    // Source text is irrelevant: the fixed LLM ignores it and emits the four claims.
    transcript: {
      async fetch(input: RawInput) {
        return { text: input.transcript ?? '', lang: 'en' };
      },
    },

    // Deterministic extraction: exactly the four claims under test, each above the
    // confidence floor so the assembled report can reach 'ready'.
    llm: {
      async extract() {
        const claim = (claimText: string) => ({
          claimText,
          transcriptSpan: claimText,
          verifiability: 'verifiable' as const,
          confidence: 0.8,
        });
        return {
          tldr: 'Integration fixture covering honest-none, context routing, and a match.',
          issueFrame: { label: 'mixed', x: 0, y: 0 },
          claims: [
            claim(CLAIM_UNMATCHED),
            claim(CLAIM_SAME_TOPIC),
            claim(CLAIM_BACKGROUND),
            claim(CLAIM_MATCHED),
          ],
          framingSignals: [],
          contextCards: [],
        };
      },
    },

    // Every claim is checkable, so each is actually searched (no triage short-circuit).
    // canonicalClaim === originalClaim keeps the keyword intact through the query pack.
    normalizer: {
      async normalize(originalClaim: string) {
        return {
          canonicalClaim: originalClaim,
          claimType: 'factual_event' as const,
          factCheckability: 'checkable' as const,
        };
      },
    },

    // Returns one claim-specific candidate per query, keyed off the surviving keyword.
    // (sourceTier here is ignored — retrieve.ts re-derives it from classifyCitationTier.)
    evidence: {
      async gather(queryText: string) {
        const cite = (sourceUrl: string, sourceName: string) => ({
          evidenceStrength: 'none' as const,
          citations: [
            {
              sourceUrl,
              sourceName,
              sourceTier: 'tier3_viewpoint' as const,
              excerpt: `re: ${queryText.slice(0, 40)}`,
              supports: null,
            },
          ],
        });
        if (/unemployment/i.test(queryText)) return cite(URL_UNMATCHED, 'Unmatched News');
        if (/berlin/i.test(queryText)) return cite(URL_SAME_TOPIC, 'History Topic');
        if (/population/i.test(queryText)) return cite(URL_BACKGROUND, 'Background Data');
        if (/growth/i.test(queryText)) return cite(URL_MATCHED, 'CDC Growth Report');
        return { evidenceStrength: 'none' as const, citations: [] };
      },
    },

    perspective: {
      async find() {
        return [];
      },
    },

    // Fixed Match_Type per claim, classified against the ORIGINAL claim (Req 3.2).
    validator: {
      async validate(originalClaim: string) {
        if (/unemployment/i.test(originalClaim))
          return { matchType: 'irrelevant' as const, matchConfidence: 0.9 };
        if (/Berlin/i.test(originalClaim))
          return { matchType: 'same_topic_different_claim' as const, matchConfidence: 0.8 };
        if (/population/i.test(originalClaim))
          return { matchType: 'background_context' as const, matchConfidence: 0.7 };
        if (/growth/i.test(originalClaim))
          return { matchType: 'same_claim' as const, matchConfidence: 0.95 };
        return { matchType: 'irrelevant' as const, matchConfidence: 0 };
      },
    },
  };
}

const INPUT: RawInput = {
  sourceType: 'transcript',
  transcript: 'fixture transcript (ignored by the fixed LLM)',
};

function findClaim(result: PipelineResult, text: string) {
  const claim = result.claims.find((c) => c.claimText === text);
  assert.ok(claim, `expected the report to contain the claim: ${text}`);
  return claim!;
}

function findAudit(result: PipelineResult, text: string) {
  const audit = result.audits.find((a) => a.originalClaim === text);
  assert.ok(audit, `expected an audit record for: ${text}`);
  return audit!;
}

test('honest no-evidence: an unmatched claim is served with zero cited evidence', async () => {
  const result = await runPipeline(INPUT, buildProviders());

  const claim = findClaim(result, CLAIM_UNMATCHED);
  // Req 7.1: no source directly verifies the claim, so it carries NO cited evidence
  // and an honest 'none' strength (which the unchanged invariant gate accepts).
  assert.equal(claim.citations.length, 0, 'unmatched claim must have zero citations');
  assert.equal(claim.evidenceStrength, 'none', "unmatched claim must be evidenceStrength 'none'");

  // And the router recorded it explicitly as no_sufficient_evidence (not a near-miss).
  const audit = findAudit(result, CLAIM_UNMATCHED);
  assert.equal(audit.evidenceOutcome, 'no_sufficient_evidence');
});

test('context routing: same_topic → usefulContext, background → Context_Card, neither cited', async () => {
  const result = await runPipeline(INPUT, buildProviders());

  // Req 7.2 / 7.4: same_topic_different_claim material goes to Useful_Context and is
  // NEVER a citation on the claim.
  const sameTopicClaim = findClaim(result, CLAIM_SAME_TOPIC);
  assert.equal(sameTopicClaim.citations.length, 0, 'same_topic claim must not be cited');
  assert.ok(
    result.usefulContext.some((c) => c.sourceUrl === URL_SAME_TOPIC),
    'same_topic candidate must be routed to usefulContext',
  );
  // It must not have leaked into any claim's ledger.
  assert.ok(
    !result.claims.some((c) => c.citations.some((cit) => cit.sourceUrl === URL_SAME_TOPIC)),
    'same_topic candidate must never appear as a citation',
  );

  // Req 7.2 / 7.4: background_context material surfaces as a Context_Card, not evidence.
  const backgroundClaim = findClaim(result, CLAIM_BACKGROUND);
  assert.equal(backgroundClaim.citations.length, 0, 'background claim must not be cited');
  assert.ok(
    result.contextCards.some((card) => card.sourceUrl === URL_BACKGROUND),
    'background_context candidate must be routed to a Context_Card',
  );
  assert.ok(
    !result.claims.some((c) => c.citations.some((cit) => cit.sourceUrl === URL_BACKGROUND)),
    'background_context candidate must never appear as a citation',
  );

  // Both context-only claims resolve to relevant_context_only with 'none' strength.
  assert.equal(findAudit(result, CLAIM_SAME_TOPIC).evidenceOutcome, 'relevant_context_only');
  assert.equal(findAudit(result, CLAIM_BACKGROUND).evidenceOutcome, 'relevant_context_only');
});

test('a single unmatched claim does not fail the report — it stays servable (ready)', async () => {
  const result = await runPipeline(INPUT, buildProviders());

  // Req 7.3: no_sufficient_evidence is a successful, served outcome. With a mix of an
  // unmatched claim, two context-only claims, and one genuine match, the assembled
  // report must remain servable — never 'failed', and here 'ready'.
  assert.notEqual(result.status, 'failed', 'an unmatched claim must not fail the report');
  assert.equal(
    result.status,
    'ready',
    `report should be servable as ready; reasons: ${result.reasons.join('; ')}`,
  );

  // The genuinely matched claim still cites real evidence — honest-none is distinct
  // from a true match, confirming the router did not blanket-suppress all evidence.
  const matched = findClaim(result, CLAIM_MATCHED);
  assert.ok(matched.citations.length >= 1, 'matched claim must carry at least one citation');
  assert.notEqual(matched.evidenceStrength, 'none', 'matched claim must assert a strength');
  assert.ok(
    matched.citations.every((c) => c.sourceUrl === URL_MATCHED),
    'matched claim must cite only its matching source',
  );
  // A same_claim, non-excluded-tier candidate yields one of the matched_* outcomes
  // (the exact one depends on the source's policy tier: cdc.gov is a primary source).
  const matchedOutcome = findAudit(result, CLAIM_MATCHED).evidenceOutcome;
  assert.ok(
    ['matched_fact_check', 'matched_primary_source', 'matched_institutional_source'].includes(
      matchedOutcome,
    ),
    `matched claim must resolve to a matched_* outcome, got ${matchedOutcome}`,
  );
});
