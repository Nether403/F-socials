// Report-graph projection (report-graph-normalization): a PURE, deterministic
// mapping from an assembled AnalysisReport to its Normalized_Rows — the
// claims/citations/perspective_links projection the dual-write persists.
//
// No I/O, no clock, no randomness: the same in-memory report object that wrote
// the JSONB payload produces these rows, so the two writes can never disagree.
// Tiers are copied straight off Citation/PerspectiveLink (sources only); there
// is structurally no creator input to read, so no creator-reliability dimension
// can exist here (Req 9.2).
//
// The projection reads the report's evidence structure exactly as the invariant
// gate produced it — a `none`/zero-citation claim yields a claim row with zero
// citation rows, any other claim yields one citation row per citation — without
// re-computing, asserting, or weakening the gate (Req 10.2). assemble.ts is
// never touched.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import type { AnalysisReport, ClaimRow, CitationRow, PerspectiveRow } from '../types';

export interface ReportGraph {
  claims: ClaimRow[];
  citations: CitationRow[];
  perspectives: PerspectiveRow[];
}

// Deterministic projection of an AnalysisReport into its normalized rows.
// Optional source fields (transcriptSpan, sourceBasis, excerpt) are omitted when
// absent so nullable columns stay null; non-normalized fields
// (Claim.evidenceDescription, PerspectiveLink.whyIncluded) are dropped entirely
// and remain only in the JSONB payload (Req 3.5).
export function projectReportGraph(report: AnalysisReport): ReportGraph {
  const claims: ClaimRow[] = [];
  const citations: CitationRow[] = [];

  report.claims.forEach((claim, ordinal) => {
    const claimRow: ClaimRow = {
      claimUid: claim.id, // stable traceback to the originating Claim (Req 2.6)
      reportId: report.id,
      claimText: claim.claimText,
      verifiability: claim.verifiability,
      evidenceStrength: claim.evidenceStrength,
      confidence: claim.confidence,
      ordinal, // render order within the report
    };
    if (claim.transcriptSpan !== undefined) claimRow.transcriptSpan = claim.transcriptSpan;
    if (claim.sourceBasis !== undefined) claimRow.sourceBasis = claim.sourceBasis;
    claims.push(claimRow);

    // One citation row per citation, linked by claimUid. A none/zero-citation
    // claim simply contributes no citation rows (empty array — no special case).
    for (const citation of claim.citations) {
      const citationRow: CitationRow = {
        claimUid: claim.id,
        sourceUrl: citation.sourceUrl,
        sourceName: citation.sourceName,
        sourceTier: citation.sourceTier,
        supports: citation.supports,
      };
      if (citation.excerpt !== undefined) citationRow.excerpt = citation.excerpt;
      citations.push(citationRow);
    }
  });

  const perspectives: PerspectiveRow[] = report.perspectives.map((p) => ({
    reportId: report.id,
    url: p.url,
    sourceName: p.sourceName,
    sourceTier: p.sourceTier,
    issueFrameLabel: p.issueFrameLabel,
    divergence: p.divergence,
    dehumanization: p.dehumanization,
  }));

  return { claims, citations, perspectives };
}

// ponytail: one runnable self-check (run `node --import tsx src/core/reportGraph.ts`).
// Projects one hand-built gate-valid report — a non-`none` claim carrying a
// citation plus an honest `none`/zero-citation claim, plus a perspective — and
// asserts cardinality and a couple of field matches. Dependency-free fast-fail
// ahead of the full property suite (tasks 7.x); only fails if the projection regresses.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const report: AnalysisReport = {
    id: 'report-self-check',
    contentId: 'content-1',
    urlHash: 'hash-1',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [
      {
        id: 'claim-cited',
        claimText: 'Global average temperature rose over the past century.',
        transcriptSpan: 'rose over the past century',
        verifiability: 'verifiable',
        evidenceStrength: 'moderate',
        sourceBasis: 'institutional record',
        confidence: 0.82,
        citations: [
          {
            sourceUrl: 'https://www.noaa.gov/climate',
            sourceName: 'NOAA',
            sourceTier: 'tier1_primary',
            excerpt: 'Temperatures have risen ~1.1°C since 1880.',
            supports: true,
          },
        ],
      },
      {
        // Honest none/zero-citation claim — a valid gate-satisfying state.
        id: 'claim-uncited',
        claimText: 'A pundit speculated about next year with no external review.',
        verifiability: 'opinion',
        evidenceStrength: 'none',
        confidence: 0.5,
        citations: [],
      },
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [
      {
        url: 'https://example.org/coverage',
        sourceName: 'Example Coverage',
        sourceTier: 'tier2_institutional',
        issueFrameLabel: 'Climate policy',
        divergence: 0.3,
        dehumanization: 0.0,
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const graph = projectReportGraph(report);

  // Cardinality: one claim row per claim, one citation row total, one perspective row.
  assert.equal(graph.claims.length, 2); // Req 2.1 — one claim row per claim
  assert.equal(graph.citations.length, 1); // Req 2.2 — only the cited claim contributes
  assert.equal(graph.perspectives.length, 1); // Req 2.3

  // The none/zero-citation claim contributes no citation rows (Req 2.7).
  assert.equal(graph.citations.filter((c) => c.claimUid === 'claim-uncited').length, 0);

  // Field matches (Req 3.1): stable traceback, render order, and a carried tier.
  const [citedRow, uncitedRow] = graph.claims;
  const [citationRow] = graph.citations;
  const [perspectiveRow] = graph.perspectives;
  assert.ok(citedRow && uncitedRow && citationRow && perspectiveRow);
  assert.equal(citedRow.claimUid, 'claim-cited'); // claimUid === claim.id
  assert.equal(citedRow.ordinal, 0);
  assert.equal(uncitedRow.claimUid, 'claim-uncited');
  assert.equal(uncitedRow.ordinal, 1);
  assert.equal(citationRow.claimUid, 'claim-cited'); // linked to its claim
  assert.equal(citationRow.sourceTier, 'tier1_primary'); // source tier carried
  assert.equal(perspectiveRow.sourceTier, 'tier2_institutional');

  // eslint-disable-next-line no-console
  console.log('reportGraph.ts self-check passed');
}
