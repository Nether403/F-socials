// Feature: progressive-disclosure-report-ui — example/smoke tests for status, modal focus,
// color-never-alone, verdict-token absence, and responsive/theming configuration.
// Validates: Requirements 7.1, 7.4, 7.5, 7.6, 7.9, 8.3, 8.6, 8.7
//
// These are concrete example tests (not fast-check). They build real report objects and assert
// the user-facing behavior the design's Testing Strategy assigns to example/interaction/smoke
// checks: the needs_review/ready status notice, the DisputeModal focus trap + focus restore,
// color-never-alone adjacency, absence of verdict tokens in the feature's own static copy, and
// the one-time responsive + theming configuration (read from styles.css).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Report } from './Report';
import type { AnalysisReport, ReportStatus } from '../api/types';

// Report imports submitFlag and DisputeModal imports submitDispute from this one module.
// A single mock covers the footer + modal flow without hitting the network.
vi.mock('../api/client', () => ({
  submitFlag: vi.fn().mockResolvedValue(undefined),
  submitDispute: vi.fn().mockResolvedValue(undefined),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = resolve(HERE, '../styles.css');

// A representative report. Every user-supplied text field is deliberately free of verdict tokens
// so the verdict-token scan exercises the feature's own copy, not arbitrary user data. provenance
// is present so the "Dispute this analysis" opener renders (needed for the modal focus tests).
// issueFrame.x has magnitude > 0.8 so the CoverageAngleNote renders inside Other Angles.
function makeReport(status: ReportStatus = 'ready'): AnalysisReport {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    id: 'report-pres',
    status,
    version: 1,
    producingLayer: 'L2',
    title: 'Cost of living coverage',
    tldr: 'A short plain-language summary of how the segment frames rising household costs.',
    issueFrame: { label: 'Economic framing', x: -0.95, y: 0.2 },
    transcript: 'The government must act now to protect ordinary families from runaway costs.',
    reasons: status === 'needs_review' ? ['low confidence', 'uncited claim'] : undefined,
    claims: [
      {
        id: 'c1',
        claimText: 'Household costs rose 12 percent over the year.',
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
            excerpt: 'Consumer prices increased 12 percent year over year.',
            supports: true,
          },
        ],
      },
    ],
    framingSignals: [
      {
        technique: 'Loaded language',
        severity: 'medium',
        description: 'Charged wording frames costs as out of control.',
        examples: [],
      },
    ],
    contextCards: [{ title: 'Missing baseline', description: 'No prior-year comparison is given.' }],
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
      lastUpdated: now,
      disputesCount: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('status notice (Req 8.6, 8.7)', () => {
  it('needs_review shows the held-for-review label with all content still intact', () => {
    const { container } = render(<Report report={makeReport('needs_review')} onBack={() => {}} />);

    // 8.6 — a visible text label states the analysis is awaiting review.
    expect(screen.getByText(/held for human review/i)).toBeInTheDocument();
    expect(screen.getByText(/showing it transparently rather than hiding it/i)).toBeInTheDocument();

    // ...and nothing is suppressed: the SummaryLead and every disclosure drawer still render.
    expect(container.querySelector('.summary-lead')).not.toBeNull();
    expect(container.querySelectorAll('.disclosure').length).toBe(5); // 4 sections + Issue-Frame
    // The summary content itself is present.
    expect(screen.getByText(/plain-language summary of how the segment frames/i)).toBeInTheDocument();
  });

  it('ready shows no review notice (Req 8.7)', () => {
    const { container } = render(<Report report={makeReport('ready')} onBack={() => {}} />);

    expect(screen.queryByText(/held for human review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing it transparently/i)).not.toBeInTheDocument();
    // The full content still renders.
    expect(container.querySelector('.summary-lead')).not.toBeNull();
    expect(container.querySelectorAll('.disclosure').length).toBe(5);
  });
});

describe('dispute modal focus trap + restore (Req 7.4, 7.5)', () => {
  it('traps focus within the modal while open', async () => {
    const user = userEvent.setup();
    render(<Report report={makeReport('ready')} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus is moved into the dialog on open (the textarea autoFocuses).
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tabbing repeatedly cycles only through the modal's controls and never escapes it (7.4).
    for (let i = 0; i < 5; i++) {
      await user.keyboard('{Tab}');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // Shift+Tab also stays trapped.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the opener button when the modal closes (Req 7.5)', async () => {
    const user = userEvent.setup();
    render(<Report report={makeReport('ready')} onBack={() => {}} />);

    const opener = screen.getByRole('button', { name: /dispute this analysis/i });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Escape closes the modal; onClose restores focus to disputeOpenerRef.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });
});

describe('color-never-alone adjacency (Req 7.1)', () => {
  it('pairs the amber underline with the "Most important framing signal" text label', () => {
    const { container } = render(<Report report={makeReport('ready')} onBack={() => {}} />);

    // The amber-underlined signal carries an adjacent text label identifying it — the emphasis
    // is conveyed by text, never by the underline color alone.
    const underline = container.querySelector('.mis-underline');
    expect(underline).not.toBeNull();
    const topSignal = underline!.closest('.top-signal');
    expect(topSignal).not.toBeNull();
    expect(topSignal!.textContent).toMatch(/most important framing signal/i);

    // A severity chip in the lead carries adjacent text, not color only.
    expect(screen.getAllByText(/medium severity/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders source-tier chips as text labels adjacent to their color indicator', async () => {
    const user = userEvent.setup();
    render(<Report report={makeReport('ready')} onBack={() => {}} />);

    // Open Other Angles so the perspective's SourceTierChip + IssueFrameChip render.
    await user.click(screen.getByRole('button', { name: /other angles/i }));
    // The tier is conveyed by the human-readable text label, never by color alone.
    expect(screen.getByText('Tier 2 · Institutional')).toBeInTheDocument();
    // The descriptive issue-frame chip renders its label as text.
    expect(screen.getByText('Market / individual')).toBeInTheDocument();
  });
});

describe('no verdict tokens in feature-owned copy (Req 8.3)', () => {
  // Truthfulness-verdict tokens the lens must never put in its own static copy. Scoped to the
  // feature's labels and notes — not arbitrary user-supplied field text — so it stays robust.
  // NOTE: "verdict" itself is intentionally excluded: the IssueFrame chart's disclaimer copy reads
  // "Where it sits (descriptive, not a verdict)", which uses the word to say it is *not* one — the
  // opposite of a violation. The denylist targets words that assert truth/falsity about content.
  const VERDICT = /\b(false|true|fake|debunked|liar|misinformation|hoax)\b/i;

  it('feature labels, the coverage-angle note, and chip copy carry no verdict tokens', async () => {
    const user = userEvent.setup();
    const { container } = render(<Report report={makeReport('ready')} onBack={() => {}} />);

    // Expand every drawer so all feature-owned copy regions are mounted.
    for (const name of [/claim ledger/i, /framing signals/i, /useful context/i, /other angles/i, /issue-frame position/i]) {
      await user.click(screen.getByRole('button', { name }));
    }
    // Open the claim drawer so its "Why this is here" rationale label mounts.
    await user.click(screen.getByText(/household costs rose 12 percent/i));

    // Collect only the feature's own static copy: section labels, drawer titles, rationale labels,
    // the issue-frame chart label, and the coverage-angle note (label + descriptive sentence).
    const copyEls = container.querySelectorAll(
      '.section-label, .disclosure-title, .rationale .sub, .sub, .axis-pos',
    );
    const featureCopy = Array.from(copyEls)
      .map((el) => el.textContent ?? '')
      .join(' | ');

    // The coverage-angle note's descriptive sentence (feature-owned static copy + pole names).
    const note = screen.getByText(/covered from one angle/i).closest('.mini-card');
    const noteCopy = note?.textContent ?? '';

    expect(featureCopy).not.toMatch(VERDICT);
    expect(noteCopy).not.toMatch(VERDICT);
    // Sanity: the note actually rendered, so the assertion above is meaningful.
    expect(noteCopy).toMatch(/frames the topic from one angle/i);
  });
});

describe('responsive single-column smoke (Req 7.6)', () => {
  it('renders a vertical drawer stack with no page-level tab bar', () => {
    const { container } = render(<Report report={makeReport('ready')} onBack={() => {}} />);

    // The mutually-exclusive tab bar was replaced by independent drawers, so there is no .tabs
    // element; the drawers are siblings in a single-column stack by construction.
    expect(container.querySelector('.tabs')).toBeNull();
    const drawers = container.querySelectorAll('.disclosure');
    expect(drawers.length).toBe(5);
    // The drawers share one parent (they stack rather than sitting in separate columns).
    const parents = new Set(Array.from(drawers).map((d) => d.parentElement));
    expect(parents.size).toBe(1);
  });

  it('styles.css defines a <=768px single-column media rule', () => {
    const css = readFileSync(STYLES_PATH, 'utf8');
    const mediaBlock = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? '';
    expect(mediaBlock.length).toBeGreaterThan(0);
    expect(mediaBlock).toMatch(/grid-template-columns:\s*1fr/);
  });
});

describe('theming smoke (Req 7.9)', () => {
  it('sources its icons from lucide-react', () => {
    const { container } = render(<Report report={makeReport('ready')} onBack={() => {}} />);
    // lucide-react renders <svg class="lucide lucide-...">; the drawer chevrons + header icons
    // all come from it, so at least one lucide svg is present on the rendered controls.
    expect(container.querySelector('svg.lucide')).not.toBeNull();
  });

  it('defines the teal #0d9488 accent in styles.css', () => {
    const css = readFileSync(STYLES_PATH, 'utf8');
    expect(css).toMatch(/--accent:\s*#0d9488/i);
  });
});
