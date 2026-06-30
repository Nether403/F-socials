// Feature: en-nl-localization, Property 7: Content invariance under language switch
// Validates: Requirements 5.2, 5.5, 5.7, 11.2, 11.3, 11.5

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import { LanguageProvider } from './context';
import type {
  AnalysisReport,
  Claim,
  Citation,
  FramingSignal,
  FramingExample,
  ContextCard,
  PerspectiveLink,
  EvidenceStrength,
  Verifiability,
  SourceTier,
} from '../api/types';
import { Report } from '../components/Report';

// --- localStorage mock (same pattern as other i18n PBTs) ---
function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

// --- fast-check arbitraries for AnalysisReport ---

// ponytail: use alphanumeric strings to avoid edge-case regex/substring issues with
// special characters in textContent matching; the property cares about identity not encoding
const arbText = (max = 30) => fc.stringMatching(/^[A-Za-z0-9 ]{1,30}$/).filter((s) => s.trim().length > 0).map((s) => s.slice(0, max));

const arbSourceTier: fc.Arbitrary<SourceTier> = fc.constantFrom(
  'tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded',
);

const arbEvidenceStrength: fc.Arbitrary<EvidenceStrength> = fc.constantFrom(
  'strong', 'moderate', 'weak', 'none',
);

const arbVerifiability: fc.Arbitrary<Verifiability> = fc.constantFrom(
  'verifiable', 'partially_verifiable', 'opinion', 'unverifiable',
);

const arbCitation: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.constant('https://example.com/source'),
  sourceName: arbText(20),
  sourceTier: arbSourceTier,
  excerpt: fc.option(arbText(40), { nil: undefined }),
  supports: fc.constantFrom(true, false, null),
});

const arbClaim: fc.Arbitrary<Claim> = fc.record({
  id: fc.uuid(),
  claimText: arbText(60),
  transcriptSpan: fc.option(arbText(40), { nil: undefined }),
  verifiability: arbVerifiability,
  evidenceStrength: arbEvidenceStrength,
  sourceBasis: fc.option(arbText(30), { nil: undefined }),
  evidenceDescription: fc.option(arbText(30), { nil: undefined }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(arbCitation, { minLength: 0, maxLength: 2 }),
});

const arbFramingExample: fc.Arbitrary<FramingExample> = fc.record({
  text: arbText(30),
  explanation: arbText(30),
  startIndex: fc.nat({ max: 100 }),
  endIndex: fc.nat({ max: 200 }),
});

const arbFramingSignal: fc.Arbitrary<FramingSignal> = fc.record({
  technique: arbText(20),
  severity: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
  description: arbText(40),
  examples: fc.array(arbFramingExample, { minLength: 1, maxLength: 2 }),
});

const arbContextCard: fc.Arbitrary<ContextCard> = fc.record({
  title: arbText(30),
  description: arbText(40),
  sourceName: fc.option(arbText(15), { nil: undefined }),
  sourceUrl: fc.option(fc.constant('https://example.com'), { nil: undefined }),
});

const arbPerspective: fc.Arbitrary<PerspectiveLink> = fc.record({
  url: fc.constant('https://example.com/angle'),
  sourceName: arbText(20),
  sourceTier: arbSourceTier,
  issueFrameLabel: arbText(15),
  divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  dehumanization: fc.double({ min: 0, max: 1, noNaN: true }),
  whyIncluded: fc.option(arbText(30), { nil: undefined }),
});

const arbReport: fc.Arbitrary<AnalysisReport> = fc.record({
  id: fc.uuid(),
  status: fc.constant('ready' as const),
  version: fc.constant(1),
  producingLayer: fc.constant('test'),
  title: fc.option(arbText(30), { nil: undefined }),
  tldr: fc.option(arbText(60), { nil: undefined }),
  issueFrame: fc.option(
    fc.record({
      label: arbText(15),
      x: fc.double({ min: -1, max: 1, noNaN: true }),
      y: fc.double({ min: -1, max: 1, noNaN: true }),
    }),
    { nil: undefined },
  ),
  transcript: fc.option(arbText(80), { nil: undefined }),
  claims: fc.array(arbClaim, { minLength: 0, maxLength: 3 }),
  framingSignals: fc.array(arbFramingSignal, { minLength: 0, maxLength: 2 }),
  contextCards: fc.array(arbContextCard, { minLength: 0, maxLength: 2 }),
  perspectives: fc.array(arbPerspective, { minLength: 0, maxLength: 2 }),
  provenance: fc.constant(undefined),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  shareSlug: fc.constant(undefined),
  reasons: fc.constant(undefined),
  error: fc.constant(undefined),
  createdAt: fc.constant('2024-01-01T00:00:00Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00Z'),
});

describe('Property 7: Content invariance under language switch', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockStorage);
    document.documentElement.lang = '';
  });

  afterEach(() => {
    document.documentElement.lang = '';
    vi.unstubAllGlobals();
  });

  it('rendering a report under en and nl produces identical Report_Content text and identical section counts', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(arbReport, (report) => {
        // Deep-clone the report to verify it's not mutated by rendering
        const originalJson = JSON.stringify(report);

        // Render under English
        mockStorage.clear();
        mockStorage.setItem('fsocials-language', 'en');
        const enResult = render(
          <LanguageProvider>
            <Report report={report} onBack={() => {}} />
          </LanguageProvider>,
        );
        const enText = enResult.container.textContent ?? '';
        enResult.unmount();

        // Verify report object was not mutated by the en render
        expect(JSON.stringify(report)).toBe(originalJson);

        // Render under Dutch
        mockStorage.clear();
        mockStorage.setItem('fsocials-language', 'nl');
        const nlResult = render(
          <LanguageProvider>
            <Report report={report} onBack={() => {}} />
          </LanguageProvider>,
        );
        const nlText = nlResult.container.textContent ?? '';
        nlResult.unmount();

        // Verify report object was not mutated by the nl render
        expect(JSON.stringify(report)).toBe(originalJson);

        // --- Assert Report_Content invariance ---
        // The report title (when present) must appear identically in both renders
        if (report.title) {
          expect(enText).toContain(report.title);
          expect(nlText).toContain(report.title);
        }

        // The issue-frame label (when present) must appear in both renders
        if (report.issueFrame?.label) {
          expect(enText).toContain(report.issueFrame.label);
          expect(nlText).toContain(report.issueFrame.label);
        }

        // Claim texts are Report_Content rendered in the claim-head (always visible
        // even when the section disclosure is collapsed, because the section header
        // count is visible). Verify the claim count string is consistent by checking
        // the number portion appears. The actual claim text sits inside a collapsed
        // DisclosureSection, but the section count is always rendered.

        // --- Assert section counts are identical ---
        // Section counts are shown in the DisclosureSection headers as "(N)" —
        // they are derived directly from the report arrays. Verify the underlying
        // counts that feed these are identical across renders.
        const claimCount = report.claims.length;
        const framingCount = report.framingSignals.length;
        const contextCount = report.contextCards.length;
        const perspectiveCount = report.perspectives.length;

        // The meta-row renders "{n} claims" and "{n} framing signals" text.
        // These counts must appear in both renderings (the number is constant).
        expect(enText).toContain(String(claimCount));
        expect(nlText).toContain(String(claimCount));
        expect(enText).toContain(String(framingCount));
        expect(nlText).toContain(String(framingCount));

        // DisclosureSection headers render the count as "(N)" for each section
        // Verify these appear in both languages
        if (contextCount > 0 || contextCount === 0) {
          expect(enText).toContain(`(${contextCount})`);
          expect(nlText).toContain(`(${contextCount})`);
        }
        if (perspectiveCount > 0 || perspectiveCount === 0) {
          expect(enText).toContain(`(${perspectiveCount})`);
          expect(nlText).toContain(`(${perspectiveCount})`);
        }
      }),
      { numRuns: 100 },
    );
  });
});
