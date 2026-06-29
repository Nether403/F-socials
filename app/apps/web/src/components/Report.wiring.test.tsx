// Feature: trust-and-launch-bundle, footer + modal wiring (Validates: 1.11, 3.8, 3.9, 3.10, 3.11)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Report } from './Report';
import type { AnalysisReport } from '../api/types';

// Both Report (submitFlag) and DisputeModal (submitDispute) import from this one module,
// so a single mock covers the whole footer + modal flow. Hoisted fns let the assertions
// reference the same vi.fn instances the components call.
const api = vi.hoisted(() => ({
  submitDispute: vi.fn<(reportId: string, body: { reason: string; claimId?: string }) => Promise<void>>(),
  submitFlag: vi.fn<(reportId: string, body: { technique: string; note?: string }) => Promise<void>>(),
}));

vi.mock('../api/client', () => ({
  submitDispute: api.submitDispute,
  submitFlag: api.submitFlag,
}));

// Minimal valid report: provenance present (footer renders), one framing signal
// (a Flag button exists), and the remaining arrays populated enough to render.
const fakeReport: AnalysisReport = {
  id: 'report-abc',
  status: 'ready',
  version: 1,
  producingLayer: 'L2',
  title: 'Test analysis',
  claims: [],
  framingSignals: [
    { technique: 'Loaded language', severity: 'medium', description: 'Charged wording.', examples: [] },
  ],
  contextCards: [],
  perspectives: [],
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
  api.submitDispute.mockReset().mockResolvedValue(undefined);
  api.submitFlag.mockReset().mockResolvedValue(undefined);
});

describe('Report footer + dispute modal wiring', () => {
  // 1.11 — the provenance footer carries a no-auth Methodology link.
  // 3.10 — the footer dispute control opens the Dispute_Modal (role="dialog").
  it('links to methodology and opens the dispute modal from the footer', async () => {
    const user = userEvent.setup();
    render(<Report report={fakeReport} onBack={() => {}} />);

    const link = screen.getByRole('link', { name: /methodology/i });
    expect(link).toHaveAttribute('href', '#/methodology');

    // No dialog before the footer control is activated.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // 3.8 — submitting sends { reason, claimId? } (claimId undefined from the footer).
  // 3.9 — a confirmation message is shown on success.
  it('submits a dispute and shows the received confirmation', async () => {
    const user = userEvent.setup();
    render(<Report report={fakeReport} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));

    const textarea = screen.getByLabelText(/your reason/i);
    await user.type(textarea, 'This claim was mischaracterized.');
    await user.click(screen.getByRole('button', { name: /submit dispute/i }));

    expect(api.submitDispute).toHaveBeenCalledTimes(1);
    expect(api.submitDispute).toHaveBeenCalledWith(
      'report-abc',
      expect.objectContaining({ reason: 'This claim was mischaracterized.' }),
    );

    expect(await screen.findByText(/received/i)).toBeInTheDocument();
  });
});
