// Feature: progressive-disclosure-report-ui, Property 11: Tier chips attach only to sources, never to the creator
// Validates: Requirements 6.3, 8.4
import { describe, it, expect } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import { TIER } from './reportView';
import type { AnalysisReport, Citation, PerspectiveLink, SourceTier } from '../api/types';

// The four human-readable tier labels are the only strings that count as a rendered tier chip.
// Counting by label TEXT (not by class) is robust: `.tag muted` is reused elsewhere (evidence
// "No external review", provenance reviewStatus), so a class-only count would over-count.
const TIER_LABELS = new Set(Object.values(TIER));

// A citation/perspective may or may not carry a usable tier: one of the four valid SourceTier
// values, an out-of-union string, or omitted. SourceTierChip renders only for the valid four.
type MaybeTier = SourceTier | 'bogus_tier' | undefined;
const maybeTierArb = fc.constantFrom<MaybeTier>(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
  'bogus_tier',
  undefined,
);
const isValidTier = (t: MaybeTier): t is SourceTier => t !== undefined && t !== 'bogus_tier';

// One claim carries 0..2 citations, each with its own maybe-tier; the report carries 0..3
// perspectives, each with its own maybe-tier. Report sizes kept modest for render speed.
const reportShapeArb = fc.record({
  claims: fc.array(fc.array(maybeTierArb, { maxLength: 2 }), { maxLength: 3 }),
  perspectiveTiers: fc.array(maybeTierArb, { maxLength: 3 }),
});

function buildReport(shape: { claims: MaybeTier[][]; perspectiveTiers: MaybeTier[] }): AnalysisReport {
  const now = new Date(0).toISOString();
  const claims = shape.claims.map((citationTiers, ci) => ({
    id: `c${ci}`,
    claimText: 'A claim under test.',
    verifiability: 'verifiable' as const,
    evidenceStrength: 'moderate' as const,
    confidence: 0.5,
    citations: citationTiers.map<Citation>((t, i) => ({
      sourceUrl: `https://example.test/${ci}/${i}`,
      sourceName: 'a source',
      // Test shim: drive the chip across valid, out-of-union, and omitted tiers (Req 6.5).
      sourceTier: t as unknown as SourceTier,
      supports: null,
    })),
  }));
  const perspectives = shape.perspectiveTiers.map<PerspectiveLink>((t, i) => ({
    url: `https://example.test/p/${i}`,
    sourceName: 'a perspective source',
    sourceTier: t as unknown as SourceTier,
    issueFrameLabel: '', // empty → IssueFrameChip omits, keeping the DOM to just tier chips
    divergence: 0.5,
    dehumanization: 0,
  }));
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    tldr: 'A short neutral summary.',
    claims,
    framingSignals: [],
    contextCards: [],
    perspectives,
    createdAt: now,
    updatedAt: now,
  };
}

// Count rendered Source_Tier_Chips within a subtree: spans whose text is exactly a TIER label.
function countTierChips(root: ParentNode): number {
  return Array.from(root.querySelectorAll('span')).filter((s) =>
    TIER_LABELS.has((s.textContent ?? '').trim()),
  ).length;
}

describe('Property 11: Tier chips attach only to sources, never to the creator', () => {
  it('rendered tier-chip count equals citations-with-tier plus perspectives-with-tier, none in header/summary', () => {
    fc.assert(
      fc.property(reportShapeArb, (shape) => {
        const expected =
          shape.claims.reduce((n, tiers) => n + tiers.filter(isValidTier).length, 0) +
          shape.perspectiveTiers.filter(isValidTier).length;

        const { container } = render(<Report report={buildReport(shape)} onBack={() => {}} />);
        try {
          // Citations live behind the collapsed Claim Ledger drawer AND each claim's own drawer;
          // perspectives live behind the collapsed Other Angles drawer. Expand them all so every
          // tier chip that would render is actually in the DOM.
          const controls = Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];
          const open = (re: RegExp) => {
            const ctl = controls.find((c) => re.test(c.textContent ?? ''));
            if (ctl) fireEvent.click(ctl);
          };
          open(/Claim Ledger/);
          open(/Other Angles/);
          container.querySelectorAll('.claim-head').forEach((h) => fireEvent.click(h));

          // Every source tier chip that should render, renders — no more, no less.
          expect(countTierChips(container)).toBe(expected);

          // No tier chip ever appears in a creator-/header-scoped region or in the Summary_Lead:
          // tiers attach to sources only, never to the Creator (Req 6.3, 8.4).
          const head = container.querySelector('.report-head');
          const summary = container.querySelector('.summary-lead');
          expect(head).not.toBeNull();
          expect(summary).not.toBeNull();
          expect(countTierChips(head!)).toBe(0);
          expect(countTierChips(summary!)).toBe(0);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000); // 100 full <Report> renders + drawer expansion need more than the 5s default.
});
