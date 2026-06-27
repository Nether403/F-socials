// Feature: trust-and-launch-bundle, accent + a11y smoke (Validates: 1.9, 4.3, 4.4, 4.5)
//
// Three smoke checks for the accessibility/branding pass:
//   1. Accent audit (4.5): the retired `#00ffe5` cyan is gone from CSS *and* tokens,
//      and the brand accent resolves to the `#0d9488` teal (light-theme --accent).
//   2. axe scan (4.3/4.4/1.9): a representative <Report> has no WCAG A/AA ARIA-wiring
//      violations. jsdom cannot measure real pixel contrast, so color-contrast is
//      disabled here and verified instead by the CSS-variable audit (task 12.3) plus
//      manual/browser review. The independent ARIA-hook assertions below pin the key
//      wiring (marker role="img"+aria-label, framing aria-describedby, modal dialog).
//   3. Responsive (4.3): a static check that the <=768px rule collapses the
//      multi-column layouts to a single column (jsdom can't compute layout).
//
// NOTE: these are smoke tests. Full WCAG 2.1 AA conformance — true contrast ratios,
// real keyboard/AT behavior, reflow — still needs manual testing in a browser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { Report } from './Report';

expect.extend(axeMatchers);
import type { AnalysisReport } from '../api/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = resolve(HERE, '../styles.css');
const TOKENS_PATH = resolve(HERE, '../../../../../Design concepts/design_system/tokens.json');

const RETIRED_ACCENT = '#00ffe5';
const BRAND_ACCENT = '#0d9488';

// Network is mocked: Report imports submitFlag, DisputeModal imports submitDispute.
vi.mock('../api/client', () => ({
  submitFlag: vi.fn().mockResolvedValue(undefined),
  submitDispute: vi.fn().mockResolvedValue(undefined),
}));

// A representative report exercising every section: claims+citations, framing signals
// with transcript examples, perspectives, an issue frame, provenance, and a tldr.
const fullReport: AnalysisReport = {
  id: 'report-a11y',
  status: 'ready',
  version: 1,
  producingLayer: 'L2',
  title: 'Accessibility smoke report',
  tldr: 'A short, plain-language summary of the analysis for above-the-fold reading.',
  issueFrame: { label: 'Economic policy', x: -0.4, y: 0.3 },
  transcript: 'The government must act now to protect ordinary families from runaway costs.',
  claims: [
    {
      id: 'c1',
      claimText: 'Costs rose 12% last year.',
      transcriptSpan: 'runaway costs',
      verifiability: 'verifiable',
      evidenceStrength: 'strong',
      evidenceDescription: 'Corroborated by a national statistics release.',
      confidence: 0.9,
      citations: [
        {
          sourceUrl: 'https://example.gov/cpi',
          sourceName: 'National Statistics Office',
          sourceTier: 'tier1_primary',
          excerpt: 'Consumer prices increased 12% year over year.',
          supports: true,
        },
      ],
    },
    {
      id: 'c2',
      claimText: 'No external review was available for this opinion.',
      verifiability: 'opinion',
      evidenceStrength: 'none',
      confidence: 0.3,
      citations: [],
    },
  ],
  framingSignals: [
    {
      technique: 'Loaded language',
      severity: 'high',
      description: 'Charged wording frames costs as out of control.',
      examples: [
        { text: 'runaway costs', explanation: 'Emotive phrasing implies crisis.', startIndex: 62, endIndex: 75 },
      ],
    },
    {
      technique: 'Appeal to urgency',
      severity: 'medium',
      description: 'Pressures the audience to act without deliberation.',
      examples: [],
    },
  ],
  contextCards: [
    { title: 'Missing baseline', description: 'No comparison to prior-year inflation is given.' },
  ],
  perspectives: [
    {
      url: 'https://example.org/angle',
      sourceName: 'Centre for Policy Studies',
      sourceTier: 'tier2_institutional',
      issueFrameLabel: 'Market / individual',
      divergence: 0.7,
      dehumanization: 0,
      whyIncluded: 'Offers a contrasting read on the cost figures.',
    },
  ],
  provenance: {
    model: 'gemini-test',
    analysisVersion: 'a1',
    sourcePolicyVersion: 'sp1',
    reviewStatus: 'auto-cleared',
    lastUpdated: '2024-01-01T00:00:00.000Z',
    disputesCount: 0,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('accent color audit (Req 4.5)', () => {
  const css = readFileSync(STYLES_PATH, 'utf8');
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));

  it('styles.css no longer contains the retired #00ffe5 cyan', () => {
    expect(css.toLowerCase()).not.toContain(RETIRED_ACCENT);
  });

  it('styles.css defines --accent: #0d9488 in the light theme block', () => {
    // Isolate the [data-theme='light'] { ... } block and confirm its --accent value.
    const lightBlock = /\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(lightBlock).toMatch(/--accent:\s*#0d9488/i);
  });

  it('the brand accent token resolves to #0d9488 and not #00ffe5', () => {
    expect(tokens.color.brand.accent.value.toLowerCase()).toBe(BRAND_ACCENT);
    expect(tokens.color.brand.accent.value.toLowerCase()).not.toBe(RETIRED_ACCENT);
    // The evidence-backed "success" signal shares the same teal (no bright cyan).
    expect(tokens.color.semantic.success.value.toLowerCase()).toBe(BRAND_ACCENT);
  });
});

describe('axe ARIA-wiring scan (Req 4.3, 4.4, 1.9)', () => {
  it('a representative report has no WCAG A/AA ARIA-wiring violations', async () => {
    const { container } = render(<Report report={fullReport} onBack={() => {}} />);
    // jsdom cannot measure real contrast, so color-contrast is excluded here and
    // covered by the CSS-variable audit (task 12.3) + manual review. Restricting to
    // wcag2a/wcag2aa also drops document-level best-practice rules (landmarks/h1)
    // that don't apply to a mounted component fragment.
    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });

  // Independent ARIA-hook assertions: even if the axe environment were flaky, these
  // pin the key wiring the design relies on (1.9 ARIA, 4.8/4.9 color-never-alone).
  it('exposes the key ARIA hooks: marker role/label, framing description, modal dialog', async () => {
    const user = userEvent.setup();
    render(<Report report={fullReport} onBack={() => {}} />);

    // Issue-frame markers are role="img" with a textual aria-label (color-never-alone).
    const markers = screen.getAllByRole('img');
    expect(markers.length).toBeGreaterThanOrEqual(2);
    markers.forEach((m) => expect(m).toHaveAttribute('aria-label'));

    // Framing highlights carry aria-describedby resolving to their explanation.
    await user.click(screen.getByRole('button', { name: /framing signals/i }));
    const mark = document.querySelector('mark');
    expect(mark).not.toBeNull();
    const descId = mark!.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe('Emotive phrasing implies crisis.');

    // The dispute modal exposes role="dialog" with aria-modal when opened.
    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

describe('responsive single-column layout (Req 4.3)', () => {
  const css = readFileSync(STYLES_PATH, 'utf8');

  it('collapses multi-column layouts to one column at <=768px', () => {
    const mediaBlock = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? '';
    expect(mediaBlock).toContain('.framing-layout');
    expect(mediaBlock).toContain('.grid-2');
    expect(mediaBlock).toMatch(/grid-template-columns:\s*1fr/);
  });
});
