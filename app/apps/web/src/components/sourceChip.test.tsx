// Feature: trust-and-launch-bundle, Property 4: A source chip renders its tier
// label and never a creator. Validates: Requirements 2.9, 6.5.
//
// We render the real <Report> with a fake report containing a single claim that
// carries one citation of a generated Source_Tier, expand the claim drawer, and
// assert the rendered Source_Chip text equals the label mapped from that tier —
// and contains no other tier label or creator reference. The Citation data model
// has no creator field, so structurally no creator can render; this test pins the
// behavioural contract (correct tier -> correct label, nothing extra) across all
// four tier values and arbitrary source names/URLs.
import { describe, it, expect } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import type { AnalysisReport, Citation, SourceTier } from '../api/types';

// The tier -> label contract required by Requirement 2.9. Re-declared here so the
// test owns the expectation independently of the component's private map.
const EXPECTED_TIER_LABEL: Record<SourceTier, string> = {
  tier1_primary: 'Tier 1 · Primary',
  tier2_institutional: 'Tier 2 · Institutional',
  tier3_viewpoint: 'Tier 3 · Viewpoint',
  excluded: 'Excluded',
};

const ALL_LABELS = Object.values(EXPECTED_TIER_LABEL);

const TIERS: SourceTier[] = ['tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded'];

// Arbitrary, human-ish source name that won't collide with the separator or any
// tier label (keeps the exact-match assertion meaningful for any generated value).
const sourceNameArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => s.replace(/·/g, '').replace(/\s+/g, ' ').trim())
  .filter((s) => s.length > 0 && !ALL_LABELS.some((label) => s.includes(label)));

function reportWithCitation(citation: Citation): AnalysisReport {
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    claims: [
      {
        id: 'c1',
        claimText: 'A claim under test.',
        verifiability: 'verifiable',
        evidenceStrength: 'moderate',
        confidence: 0.5,
        citations: [citation],
      },
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('Property 4: a source chip renders its tier label and never a creator', () => {
  it('renders the mapped tier label only for any tier and arbitrary source', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIERS), sourceNameArb, fc.webUrl(), (tier, sourceName, sourceUrl) => {
        const citation: Citation = {
          sourceUrl,
          sourceName,
          sourceTier: tier,
          // No excerpt and unknown support: the chip's name row is exactly
          // "<sourceName> · <tierLabel>" with no trailing supports/contradicts text.
          supports: null,
        };

        const { container } = render(<Report report={reportWithCitation(citation)} onBack={() => {}} />);
        try {
          // Claims sit behind a collapsed disclosure drawer (progressive-disclosure-report-ui
          // Req 2.1); open it, then expand the claim's own drawer where citations live.
          fireEvent.click(screen.getByRole('button', { name: /Claim Ledger/i }));
          const head = container.querySelector('.claim-head');
          expect(head).not.toBeNull();
          fireEvent.click(head as Element);

          const expectedLabel = EXPECTED_TIER_LABEL[tier];

          // The source name renders on the citation's name row; the tier label now renders as
          // its own Source_Tier_Chip (single source of truth) rather than appended inline text.
          const nameEl = container.querySelector('.citation .name');
          expect(nameEl).not.toBeNull();
          expect(nameEl?.textContent).toBe(sourceName);

          // None of the other three tier labels appear anywhere in the rendered
          // report — the mapping is exact and never a different/creator label.
          const text = container.textContent ?? '';
          expect(text).toContain(expectedLabel);
          for (const label of ALL_LABELS) {
            if (label !== expectedLabel) expect(text).not.toContain(label);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 full-<Report> renders + cleanup take longer than the 5s default.
  }, 30000);
});
