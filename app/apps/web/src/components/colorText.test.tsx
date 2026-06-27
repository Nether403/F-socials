// Feature: trust-and-launch-bundle, Property 11: Color-coded signals always carry equivalent text
// Validates: Requirements 4.6
//
// For any evidence-strength, framing-severity, or source-tier value rendered in the
// report, the corresponding element must expose an equivalent TEXT label (not color
// alone). We render <Report> with a fake report parameterized by generated values and
// assert the text label is present for each color-coded value across all combinations.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import type {
  AnalysisReport,
  EvidenceStrength,
  FramingSignal,
  SourceTier,
} from '../api/types';

// The exact label maps mirrored from Report.tsx — the text equivalents that must appear.
const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: 'Well-sourced',
  moderate: 'Sourced',
  weak: 'Lightly sourced',
  none: 'No external review',
};

const TIER_LABEL: Record<SourceTier, string> = {
  tier1_primary: 'Tier 1 · Primary',
  tier2_institutional: 'Tier 2 · Institutional',
  tier3_viewpoint: 'Tier 3 · Viewpoint',
  excluded: 'Excluded',
};

// True when some rendered element exposes `substr` as visible text content.
function hasText(substr: string): boolean {
  return screen.queryAllByText((_, el) => el?.textContent?.includes(substr) ?? false).length > 0;
}

function makeReport(
  evidenceStrength: EvidenceStrength,
  severity: FramingSignal['severity'],
  sourceTier: SourceTier,
): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    title: 'Test report',
    transcript: 'Some transcript text for the framing tab.',
    claims: [
      {
        id: 'c1',
        claimText: 'CLAIM_UNDER_TEST',
        verifiability: 'verifiable',
        evidenceStrength,
        confidence: 0.5,
        citations: [
          {
            sourceUrl: 'https://example.com',
            sourceName: 'Example Source',
            sourceTier,
            supports: null,
          },
        ],
      },
    ],
    framingSignals: [
      {
        technique: 'Loaded language',
        severity,
        description: 'A framing signal under test.',
        examples: [],
      },
    ],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

const strengthArb = fc.constantFrom<EvidenceStrength>('strong', 'moderate', 'weak', 'none');
const severityArb = fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high');
const tierArb = fc.constantFrom<SourceTier>(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
);

describe('Property 11: color-coded signals always carry equivalent text', () => {
  it('exposes a text label for every evidence-strength, severity, and source-tier value', () => {
    fc.assert(
      fc.property(strengthArb, severityArb, tierArb, (evidenceStrength, severity, sourceTier) => {
        const report = makeReport(evidenceStrength, severity, sourceTier);
        render(<Report report={report} onBack={() => {}} />);
        try {
          // 1. Evidence strength — label text appears on the claim card (Claim Ledger tab is default).
          expect(hasText(STRENGTH_LABEL[evidenceStrength])).toBe(true);

          // 2. Source tier — open the claim drawer, then the citation's tier label text appears.
          fireEvent.click(screen.getByText('CLAIM_UNDER_TEST'));
          expect(hasText(TIER_LABEL[sourceTier])).toBe(true);

          // 3. Framing severity — switch to the Framing tab; severity is rendered as "<severity> severity".
          fireEvent.click(screen.getByRole('button', { name: /Framing Signals/i }));
          expect(hasText(`${severity} severity`)).toBe(true);
        } finally {
          // Property runs render many times in one test; clean the DOM between runs.
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000); // 100 full renders + DOM scans run well over the 5s default.
});
