// Feature: progressive-disclosure-report-ui — example tests for the SummaryLead branches.
// Covers first-paint TLDR + signal content, the amber underline paired with its adjacent
// text label (color-never-alone), and the TLDR-only / signal-only / no-summary branches.
// Validates: Requirements 1.1, 1.4, 1.6, 1.7, 1.8
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SummaryLead } from './SummaryLead';
import { LanguageProvider } from '../i18n/context';
import type { AnalysisReport, FramingSignal } from '../api/types';

afterEach(cleanup);

const signal: FramingSignal = {
  technique: 'Loaded language',
  severity: 'high',
  description: 'Emotionally charged wording steers the reader toward a conclusion.',
  examples: [],
};

// Minimal report carrying only the fields SummaryLead reads; the rest satisfy the type.
function buildReport(tldr: string | undefined, framingSignals: FramingSignal[]): AnalysisReport {
  const now = new Date(0).toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    tldr,
    claims: [],
    framingSignals,
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Helper: wrap in LanguageProvider so useT resolves.
function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('SummaryLead branches', () => {
  it('first paint: renders both the TLDR and the most-important framing signal', () => {
    const tldr = 'This clip argues a single policy with charged wording.';
    const { container } = renderWithLang(<SummaryLead report={buildReport(tldr, [signal])} />);

    // TLDR content.
    expect(screen.getByText(tldr)).toBeTruthy();
    // Signal content: technique, severity tag, description.
    expect(screen.getByText(signal.technique)).toBeTruthy();
    expect(screen.getByText('high severity')).toBeTruthy();
    expect(screen.getByText(signal.description)).toBeTruthy();
    // No honest-absence statement when content exists.
    expect(screen.queryByText('No summary available for this analysis.')).toBeNull();
    // Both section labels present.
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Most important framing signal')).toBeTruthy();
    // Sanity: nothing collapsed/hidden — the lead is expanded by construction.
    expect(container.querySelector('.summary-lead')).toBeTruthy();
  });

  it('color-never-alone: the amber underline carries an adjacent visible text label (Req 1.4)', () => {
    const { container } = renderWithLang(<SummaryLead report={buildReport(undefined, [signal])} />);

    // The soft amber underline marks the signal technique.
    const underline = container.querySelector('.mis-underline');
    expect(underline).toBeTruthy();
    expect(underline?.textContent).toBe(signal.technique);
    // The emphasis is also conveyed by text, not the underline color alone.
    expect(screen.getByText('Most important framing signal')).toBeTruthy();
  });

  it('TLDR-only: renders the TLDR and omits the framing-signal portion (Req 1.6)', () => {
    const tldr = 'A concise summary with no framing signals detected.';
    renderWithLang(<SummaryLead report={buildReport(tldr, [])} />);

    expect(screen.getByText(tldr)).toBeTruthy();
    expect(screen.getByText('Summary')).toBeTruthy();
    // No signal section: neither its label nor its underline.
    expect(screen.queryByText('Most important framing signal')).toBeNull();
    expect(document.querySelector('.mis-underline')).toBeNull();
    expect(screen.queryByText('No summary available for this analysis.')).toBeNull();
  });

  it('signal-only: whitespace TLDR is treated as absent and the TLDR portion is omitted (Req 1.7)', () => {
    renderWithLang(<SummaryLead report={buildReport('   \n\t  ', [signal])} />);

    // Signal section renders.
    expect(screen.getByText(signal.technique)).toBeTruthy();
    expect(screen.getByText('Most important framing signal')).toBeTruthy();
    // TLDR portion omitted: no "Summary" label.
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.queryByText('No summary available for this analysis.')).toBeNull();
  });

  it('no-summary: with no TLDR and no signals, renders exactly the honest-absence statement (Req 1.8)', () => {
    renderWithLang(<SummaryLead report={buildReport('  ', [])} />);

    expect(screen.getByText('No summary available for this analysis.')).toBeTruthy();
    // Neither portion is present.
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.queryByText('Most important framing signal')).toBeNull();
    expect(document.querySelector('.mis-underline')).toBeNull();
  });
});
