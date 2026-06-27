// Feature: trust-and-launch-bundle, methodology rendering (Validates: 1.1,1.2,1.3,1.4,1.5,1.6,1.8,1.10)
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Methodology } from './Methodology';

// A fake PolicyDescriptor with a known version and sample tiers/open signals.
// Hoisted so it can be referenced both by the vi.mock factory and the assertions.
const fakePolicy = vi.hoisted(() => ({
  version: 'v-test-123',
  tiers: [
    { tier: 'tier1_primary', label: 'Primary source', meaning: 'A first-party record.' },
    { tier: 'tier2_institutional', label: 'Institutional', meaning: 'An institutional publisher.' },
    { tier: 'tier3_viewpoint', label: 'Viewpoint', meaning: 'A general viewpoint source.' },
    { tier: 'excluded', label: 'Excluded', meaning: 'Could not be resolved.' },
  ],
  openSignals: [
    { name: 'IFCN signatory list', raises: 'tier2_institutional' },
    { name: 'Institutional domain registry', raises: 'tier1_primary' },
  ],
}));

// Mock the API client so the component does not hit the network on mount.
vi.mock('../api/client', () => ({
  getPolicy: vi.fn().mockResolvedValue(fakePolicy),
}));

describe('Methodology page rendering', () => {
  // 1.1 — renders with no auth context/provider, just the onBack prop.
  it('renders without authentication', () => {
    const { container } = render(<Methodology onBack={() => {}} />);
    expect(container).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /how f-socials works/i })).toBeInTheDocument();
  });

  // 1.2 — evidence-outcome vocabulary plus what raises/lowers confidence.
  it('describes evidence outcomes and what raises or lowers confidence', () => {
    render(<Methodology onBack={() => {}} />);
    expect(screen.getByText(/directly matched fact-check/i)).toBeInTheDocument();
    expect(screen.getByText(/no sufficient evidence found/i)).toBeInTheDocument();
    expect(screen.getByText(/not fact-checkable/i)).toBeInTheDocument();
    expect(screen.getByText(/what raises confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/what lowers it/i)).toBeInTheDocument();
  });

  // 1.3 + 1.6 — source-tier policy, open signals, and the live (mocked) version.
  it('describes the source-tier policy with open signals and the live version', async () => {
    render(<Methodology onBack={() => {}} />);
    expect(screen.getByText(/source tier policy/i)).toBeInTheDocument();
    // Tier labels and open-signal names load after the async /policy fetch resolves.
    expect(await screen.findByText(/open signals behind each tier/i)).toBeInTheDocument();
    // Both open signals render in the policy list (the names also appear in glossary
    // definitions, so assert via the list-item "raises a source to" copy).
    expect(screen.getAllByText(/raises a source to/i)).toHaveLength(2);
    expect(screen.getAllByText(/IFCN signatory list/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Institutional')).toBeInTheDocument();
    // 1.6 — the mocked policy version is shown.
    expect(await screen.findByText(/v-test-123/)).toBeInTheDocument();
  });

  // 1.4 — who reviews reports and the meaning of each review status.
  it('describes who reviews reports and the review statuses', () => {
    render(<Methodology onBack={() => {}} />);
    expect(screen.getByText(/who reviews reports/i)).toBeInTheDocument();
    expect(screen.getByText(/passed every automated integrity check/i)).toBeInTheDocument();
    expect(screen.getByText(/held the report for a human look/i)).toBeInTheDocument();
    expect(screen.getByText(/analysis could not be completed/i)).toBeInTheDocument();
  });

  // 1.5 — how to submit a dispute.
  it('describes how to submit a dispute', () => {
    render(<Methodology onBack={() => {}} />);
    expect(screen.getByText(/how to dispute an analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/dispute this analysis/i)).toBeInTheDocument();
  });

  // 1.8 — the neutrality statement: framing/evidence, never verdicts or creator labels.
  it('states the neutrality commitment', () => {
    render(<Methodology onBack={() => {}} />);
    expect(screen.getByText(/our neutrality commitment/i)).toBeInTheDocument();
    expect(screen.getByText(/framing and evidence/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does not present verdicts about content.*never attaches a reliability label to a creator/i),
    ).toBeInTheDocument();
  });

  // 1.10 — glossary terms defined on first use (rendered via <dfn>).
  it('defines glossary terms on first use', () => {
    const { container } = render(<Methodology onBack={() => {}} />);
    expect(container.querySelectorAll('dfn').length).toBeGreaterThan(0);
    // First-use definition of "f-Socials" is shown inline.
    expect(
      screen.getByText(/a content-analysis system that produces inspectable reports/i),
    ).toBeInTheDocument();
    // "Open Signals" glossary definition is present.
    expect(screen.getByText(/freely and commercially usable reliability signals/i)).toBeInTheDocument();
  });
});
