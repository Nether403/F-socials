// Feature: expert-review-queue, Reviewer Console UI (task 12.4)
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
//
// jsdom + React Testing Library. The console's four client calls (getReviewQueue,
// claimReviewItem, releaseReviewItem, resolveReviewItem) are mocked so no test hits
// the network, mirroring the vi.mock('../api/client', …) pattern in Methodology.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ReviewerConsole } from './ReviewerConsole';
import type { ReviewItem } from '../api/types';

vi.mock('../api/client', () => ({
  getReviewQueue: vi.fn(),
  claimReviewItem: vi.fn(),
  releaseReviewItem: vi.fn(),
  resolveReviewItem: vi.fn(),
}));

// Pull the mocked functions back in, typed, so each test configures their behavior.
import * as client from '../api/client';
const mockGetQueue = vi.mocked(client.getReviewQueue);
const mockClaim = vi.mocked(client.claimReviewItem);
const mockRelease = vi.mocked(client.releaseReviewItem);
const mockResolve = vi.mocked(client.resolveReviewItem);

const disputeItem: ReviewItem = {
  id: 'dispute:d1',
  kind: 'dispute',
  reportId: 'report-aaa',
  status: 'pending',
  assignedReviewer: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  reason: 'The framing here overstates the evidence.',
  claimId: 'claim-7',
};

const flagItem: ReviewItem = {
  id: 'flag:f1',
  kind: 'flag',
  reportId: 'report-bbb',
  status: 'in_review',
  assignedReviewer: 'reviewer-9',
  createdAt: '2024-01-02T00:00:00.000Z',
  technique: 'Loaded language',
  note: 'Saw it in the intro.',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ReviewerConsole', () => {
  // 11.1 — the queue lists each item's report context, dispute reason / flagged
  // technique, status, and an explicit "unassigned" label when no reviewer is assigned.
  it('lists items with report context, reason/technique, status, and an explicit unassigned label', async () => {
    mockGetQueue.mockResolvedValue([disputeItem, flagItem]);
    render(<ReviewerConsole />);

    // Report context for both items.
    expect(await screen.findByText('report-aaa')).toBeInTheDocument();
    expect(screen.getByText('report-bbb')).toBeInTheDocument();

    // Dispute reason and flagged technique surface their respective fields.
    expect(screen.getByText('Dispute reason')).toBeInTheDocument();
    expect(screen.getByText(/overstates the evidence/i)).toBeInTheDocument();
    expect(screen.getByText('Flagged technique')).toBeInTheDocument();
    expect(screen.getByText('Loaded language')).toBeInTheDocument();

    // Status labels (text, not color alone).
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();

    // Assignee: the unassigned dispute shows an explicit "Unassigned" label; the
    // assigned flag shows the assignee id.
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText(/Assigned to reviewer-9/i)).toBeInTheDocument();
  });

  // 11.2 — claim/release/resolve are real, focusable, operable buttons.
  it('exposes keyboard-operable claim, release, and resolve controls', async () => {
    mockGetQueue.mockResolvedValue([disputeItem]);
    render(<ReviewerConsole />);

    const claim = await screen.findByRole('button', { name: /claim review item/i });
    const release = screen.getByRole('button', { name: /release review item/i });
    const resolve = screen.getByRole('button', { name: /resolve review item/i });

    for (const btn of [claim, release, resolve]) {
      expect(btn.tagName).toBe('BUTTON');
      expect(btn).not.toBeDisabled();
      btn.focus();
      expect(btn).toHaveFocus();
    }
  });

  // 11.3 — color-never-alone: every status indicator carries a text label; interactive
  // controls expose aria-label/aria-describedby.
  it('pairs status color with a text label and exposes ARIA descriptions on controls', async () => {
    mockGetQueue.mockResolvedValue([disputeItem]);
    render(<ReviewerConsole />);

    // The status tag carries the visible text label "Pending" (color-never-alone).
    const statusTag = await screen.findByText('Pending');
    expect(statusTag).toBeInTheDocument();

    // Interactive controls expose an aria-label and an aria-describedby that references
    // the item heading and its status element.
    const claim = screen.getByRole('button', { name: /claim review item for report report-aaa/i });
    expect(claim).toHaveAttribute('aria-label');
    const describedBy = claim.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // Each referenced id must resolve to an element in the document.
    for (const id of (describedBy ?? '').split(/\s+/)) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  // 11.4 — single column at <=768px. jsdom does not apply media queries, so assert the
  // responsive structure the @media (max-width: 768px) rule targets is present: the
  // .review-list contains .review-item rows whose grid collapses to one column.
  it('renders the responsive .review-list / .review-item structure the media query targets', async () => {
    mockGetQueue.mockResolvedValue([disputeItem]);
    const { container } = render(<ReviewerConsole />);

    await screen.findByText('report-aaa');
    expect(container.querySelector('.review-list')).not.toBeNull();
    expect(container.querySelector('.review-item')).not.toBeNull();
  });

  // 11.5 — empty queue renders an explicit message, not a blank view.
  it('shows an explicit empty-queue state when the queue returns no items', async () => {
    mockGetQueue.mockResolvedValue([]);
    render(<ReviewerConsole />);

    expect(await screen.findByText(/the review queue is empty/i)).toBeInTheDocument();
  });

  // 11.6 — a failed queue load shows an error state with retry + back controls; an
  // auth-shaped failure resolves to a sign-in state.
  it('shows an error state with retry/back when the queue load fails', async () => {
    mockGetQueue.mockRejectedValue(new Error('Could not load review queue (500)'));
    render(<ReviewerConsole />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load review queue/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // A back control is present (the header also carries one, so allow multiple).
    expect(screen.getAllByRole('button', { name: /back/i }).length).toBeGreaterThan(0);
  });

  it('resolves an authorization error to a sign-in state with retry/back', async () => {
    mockGetQueue.mockRejectedValue(new Error('not_a_reviewer'));
    render(<ReviewerConsole />);

    expect(await screen.findByText(/signed in as a reviewer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /back/i }).length).toBeGreaterThan(0);
  });

  // 11.7 — while the queue request is in flight, show a loading state, not a partial view.
  it('shows a loading state while the queue request is pending', () => {
    // A never-resolving promise keeps the console in its loading phase.
    mockGetQueue.mockReturnValue(new Promise<ReviewItem[]>(() => {}));
    render(<ReviewerConsole />);

    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent(/loading the review queue/i);
  });

  // 11.8 — a successful claim updates the displayed status and assignee to the new state.
  it('updates status and assignee when a claim succeeds', async () => {
    mockGetQueue.mockResolvedValue([disputeItem]);
    mockClaim.mockResolvedValue({
      ...disputeItem,
      status: 'in_review',
      assignedReviewer: 'reviewer-1',
    });
    render(<ReviewerConsole />);

    const claim = await screen.findByRole('button', { name: /claim review item for report report-aaa/i });
    // Before the action: pending + unassigned.
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    fireEvent.click(claim);

    // After the action resolves: status and assignee reflect the returned item.
    expect(await screen.findByText('In review')).toBeInTheDocument();
    expect(screen.getByText(/Assigned to reviewer-1/i)).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  // 11.9 — a failed claim surfaces an error, leaves the displayed item unchanged, and
  // keeps the controls operable for retry.
  it('leaves the item unchanged and keeps controls operable when a claim fails', async () => {
    mockGetQueue.mockResolvedValue([disputeItem]);
    mockClaim.mockRejectedValue(new Error('review_item_conflict'));
    render(<ReviewerConsole />);

    const claim = await screen.findByRole('button', { name: /claim review item for report report-aaa/i });
    fireEvent.click(claim);

    // An error indication appears…
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/review_item_conflict/i));

    // …the displayed state is unchanged (still pending + unassigned)…
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    // …and the controls remain present and operable for retry.
    const claimAfter = screen.getByRole('button', { name: /claim review item for report report-aaa/i });
    expect(claimAfter).not.toBeDisabled();
    claimAfter.focus();
    expect(claimAfter).toHaveFocus();
  });
});
