// Feature: expert-review-queue, honest absence rendering (Validates: Requirements 9.4)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ReviewerConsole } from './ReviewerConsole';
import type { ReviewItem } from '../api/types';

// A queue with one dispute-derived item for a report that carries no external
// evidence/review. The queue only ever projects intake context (a dispute reason),
// never an external review or verdict — so this item exercises the honest-absence path.
const noEvidenceItem: ReviewItem = vi.hoisted(() => ({
  id: 'dispute:abc-123',
  kind: 'dispute',
  reportId: 'report-xyz',
  status: 'pending',
  assignedReviewer: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  reason: 'The summary leaves out the dissenting study.',
}));

// Mock the API client so the component does not hit the network on mount and the queue
// resolves with our no-evidence item (mirrors the vi.mock pattern in Methodology.test.tsx).
vi.mock('../api/client', () => ({
  getReviewQueue: vi.fn().mockResolvedValue([noEvidenceItem]),
  claimReviewItem: vi.fn(),
  releaseReviewItem: vi.fn(),
  resolveReviewItem: vi.fn(),
}));

// Verdict vocabulary the lens must never substitute for absent evidence (Req 9.4 /
// compass). Word-boundary matched so "found" / "review" don't trip "true"/"reliable".
const BANNED_VERDICT = /\b(true|false|reliable|unreliable|misinformation|disinformation|accurate|inaccurate|fake)\b/i;

describe('ReviewerConsole honest absence (Req 9.4)', () => {
  it('renders the labeled "no external review found" state for a no-evidence report', async () => {
    render(<ReviewerConsole onBack={() => {}} />);
    // The item loads after the async getReviewQueue resolves.
    expect(await screen.findByText(/no external review found/i)).toBeInTheDocument();
  });

  it('substitutes no truthfulness/reliability verdict for the absent evidence', async () => {
    const { container } = render(<ReviewerConsole onBack={() => {}} />);

    // Wait for the queue to render, then scope to the rendered review item.
    await screen.findByText(/no external review found/i);
    const item = container.querySelector('.review-item') as HTMLElement;
    expect(item).not.toBeNull();

    // The honest-absence label is the only disposition shown for the report.
    expect(within(item).getByText(/no external review found/i)).toBeInTheDocument();

    // No banned verdict word appears anywhere in the rendered item's visible text —
    // the absent evidence is reported honestly, never replaced by a verdict.
    expect(item.textContent ?? '').not.toMatch(BANNED_VERDICT);
  });
});
