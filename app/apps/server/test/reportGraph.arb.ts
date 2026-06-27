// Shared fast-check arbitrary for the report-graph-normalization property suite.
// Feature: report-graph-normalization — generators (task 7.1).
//
// `gateValidReportArbitrary` produces AnalysisReport objects in the exact shape
// `core/assemble.ts` emits for a *ready* report — i.e. reports that satisfy the
// invariant gate BY CONSTRUCTION:
//   1. >=1 claim,
//   2. no claim asserts an evidence strength it cannot cite (a claim with
//      evidenceStrength 'none' carries zero citations; any non-'none' claim
//      carries >=1 citation),
//   3. every framing signal has >=1 example with non-blank text + explanation,
//   4. confidence clears the floor (CONFIDENCE_FLOOR = 0.4).
//
// The generators deliberately cover the projection's edge cases so the property
// tests never have to special-case them: the honest 'none'/zero-citation claim
// (Req 2.7), every non-'none' strength with citations (Req 2.8), varied
// sourceTier values, unicode claim/citation/perspective text, absent optional
// fields (transcriptSpan, sourceBasis, excerpt, evidenceDescription,
// whyIncluded), and reports with zero perspectives. Required report fields
// (id, contentId, urlHash, status, version, producingLayer, shareSlug,
// timestamps) are populated so the report is usable by projectReportGraph and
// the memory repository's saveReport / getReport / getReportBySlug.
//
// This file is a generator, not a test — it carries no `node:test` cases. The
// guarded self-check at the bottom (run via `tsx test/reportGraph.arb.ts`)
// asserts gate-validity against the real assembleReport gate as a fast-fail.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';

import { assembleReport } from '../src/core/assemble';
import type {
  AnalysisReport,
  Citation,
  Claim,
  EvidenceStrength,
  FramingSignal,
  PerspectiveLink,
  SourceTier,
  Verifiability,
} from '../src/types';

const TIERS: SourceTier[] = [
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
];
const VERIFIABILITIES: Verifiability[] = [
  'verifiable',
  'partially_verifiable',
  'opinion',
  'unverifiable',
];
// Strengths that the gate requires >=1 citation for. 'none' is handled separately.
const CITED_STRENGTHS: EvidenceStrength[] = ['strong', 'moderate', 'weak'];

// Full-unicode text (emoji, CJK, combining marks), and often empty — exercises
// the projection over the messy text the LLM can emit. Gate-validity never
// depends on these being non-empty.
const text = fc.string({ unit: 'grapheme' });
// Optional text field: sometimes present (possibly empty), sometimes absent.
const optionalText = fc.option(text, { nil: undefined });
// A non-blank string (survives .trim()) — required for framing example evidence.
const nonBlankText = fc.string({ unit: 'grapheme' }).map((s) => `x${s}`);

const citationArb: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: text,
  sourceTier: fc.constantFrom(...TIERS),
  excerpt: optionalText,
  supports: fc.constantFrom(true, false, null),
});

// A single claim. Half are the honest 'none' state (zero citations); the rest
// assert a non-'none' strength and carry >=1 citation — both gate-valid shapes.
const claimArb: fc.Arbitrary<Claim> = fc
  .record({
    id: fc.uuid(),
    claimText: text,
    transcriptSpan: optionalText,
    verifiability: fc.constantFrom(...VERIFIABILITIES),
    sourceBasis: optionalText,
    evidenceDescription: optionalText, // non-normalized field — stays in JSONB only
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    honestNone: fc.boolean(),
    citedStrength: fc.constantFrom(...CITED_STRENGTHS),
    citations: fc.array(citationArb, { minLength: 1, maxLength: 4 }),
  })
  .map((r) => {
    const claim: Claim = {
      id: r.id,
      claimText: r.claimText,
      verifiability: r.verifiability,
      evidenceStrength: r.honestNone ? 'none' : r.citedStrength,
      confidence: r.confidence,
      citations: r.honestNone ? [] : r.citations,
    };
    // Omit absent optional fields entirely (don't set them to undefined keys
    // beyond what the source object would carry).
    if (r.transcriptSpan !== undefined) claim.transcriptSpan = r.transcriptSpan;
    if (r.sourceBasis !== undefined) claim.sourceBasis = r.sourceBasis;
    if (r.evidenceDescription !== undefined) claim.evidenceDescription = r.evidenceDescription;
    return claim;
  });

// A gate-valid framing signal: >=1 example, each with non-blank text + explanation.
const framingSignalArb: fc.Arbitrary<FramingSignal> = fc.record({
  technique: text,
  severity: fc.constantFrom('low', 'medium', 'high'),
  description: text,
  examples: fc.array(
    fc.record({
      text: nonBlankText,
      explanation: nonBlankText,
      startIndex: fc.integer({ min: -1, max: 1000 }),
      endIndex: fc.integer({ min: -1, max: 1000 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

const perspectiveArb: fc.Arbitrary<PerspectiveLink> = fc
  .record({
    url: fc.webUrl(),
    sourceName: text,
    sourceTier: fc.constantFrom(...TIERS),
    issueFrameLabel: text,
    divergence: fc.float({ min: 0, max: 1, noNaN: true }),
    dehumanization: fc.float({ min: 0, max: 1, noNaN: true }),
    whyIncluded: optionalText, // non-normalized field — stays in JSONB only
  })
  .map((p) => {
    const link: PerspectiveLink = {
      url: p.url,
      sourceName: p.sourceName,
      sourceTier: p.sourceTier,
      issueFrameLabel: p.issueFrameLabel,
      divergence: p.divergence,
      dehumanization: p.dehumanization,
    };
    if (p.whyIncluded !== undefined) link.whyIncluded = p.whyIncluded;
    return link;
  });

// ISO timestamp from a bounded epoch so the string is always a valid Date.
const isoTimestamp = fc.integer({ min: 0, max: 4_000_000_000_000 }).map((ms) =>
  new Date(ms).toISOString(),
);

export const gateValidReportArbitrary: fc.Arbitrary<AnalysisReport> = fc
  .record({
    id: fc.uuid(),
    contentId: fc.uuid(),
    urlHash: fc.string({ unit: 'grapheme-ascii', minLength: 8, maxLength: 64 }),
    version: fc.integer({ min: 1, max: 10 }),
    claims: fc.array(claimArb, { minLength: 1, maxLength: 5 }),
    framingSignals: fc.array(framingSignalArb, { maxLength: 3 }),
    // maxLength only (no minLength) -> includes reports with zero perspectives.
    perspectives: fc.array(perspectiveArb, { maxLength: 4 }),
    tldr: text,
    title: optionalText,
    transcript: optionalText,
    issueFrameLabel: text,
    issueFrameX: fc.float({ min: -1, max: 1, noNaN: true }),
    issueFrameY: fc.float({ min: -1, max: 1, noNaN: true }),
    // >= CONFIDENCE_FLOOR (0.4) so the gate never trips on confidence.
    // Math.fround keeps it a valid 32-bit float; the result (~0.40000001) still
    // clears the floor (the gate fails only when confidence < 0.4).
    confidence: fc.float({ min: Math.fround(0.4), max: 1, noNaN: true }),
    shareSlug: fc.uuid(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .map((r) => {
    // Guarantee unique claim ids within the report (the Postgres unique index is
    // on (report_id, claim_uid)); fc.uuid() collisions inside one array are rare
    // but suffixing the ordinal makes uniqueness total.
    const claims = r.claims.map((c, i) => ({ ...c, id: `${c.id}-${i}` }));

    const report: AnalysisReport = {
      id: r.id,
      contentId: r.contentId,
      urlHash: r.urlHash,
      status: 'ready',
      version: r.version,
      producingLayer: 'ai',
      tldr: r.tldr,
      issueFrame: { label: r.issueFrameLabel, x: r.issueFrameX, y: r.issueFrameY },
      claims,
      framingSignals: r.framingSignals,
      contextCards: [],
      perspectives: r.perspectives,
      confidence: r.confidence,
      shareSlug: r.shareSlug,
      reasons: [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    if (r.title !== undefined) report.title = r.title;
    if (r.transcript !== undefined) report.transcript = r.transcript;
    return report;
  });

// ── Guarded self-check (ponytail: one runnable check behind the generator) ──
// Runs only on direct invocation (`tsx test/reportGraph.arb.ts`), never on
// import. Asserts every sampled report actually clears the real invariant gate,
// so a regression in the generators fails fast, ahead of the property suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const samples = fc.sample(gateValidReportArbitrary, 500);
  for (const report of samples) {
    assert.ok(report.claims.length >= 1, 'report must have >=1 claim');
    // Re-run the actual gate over the report's gate-relevant inputs.
    const gated = assembleReport({
      tldr: report.tldr ?? '',
      issueFrame: report.issueFrame!,
      claims: report.claims,
      framingSignals: report.framingSignals,
      contextCards: report.contextCards,
      perspectives: report.perspectives,
      confidence: report.confidence!,
    });
    assert.equal(
      gated.status,
      'ready',
      `generated report should be gate-valid but got reasons: ${gated.reasons.join('; ')}`,
    );
  }
  console.log(`reportGraph.arb self-check OK — ${samples.length} sampled reports all gate-valid`);
}
