// Feature: institutional-workspace, Workspace_View detail-surface component tests (task 8.3)
// Validates: Requirements 6.4, 7.2, 10.1, 10.2, 10.3, 10.6, 13.6, 14.1, 14.2, 14.3, 14.4, 14.7, 14.8
//
// Example-based component coverage for WorkspaceDetailView: members and collections
// render from mocked data; creating a collection / annotation updates the list;
// collection items and annotations render newest-first in the server-provided order
// (Req 6.4, 7.2); a 403 (WorkspaceForbiddenError) shows the access-denied message and
// renders NO workspace data (Req 13.6); neutrality — no truthfulness verdict, no
// creator-reliability rating, no source-tier chip on this surface, and an annotation
// shown as an author-attributed note (Req 10.1, 10.2, 10.3, 10.6); and accessibility —
// axe has no violations, controls carry accessible names + roles and are keyboard
// reachable, status flows through an ARIA live region, single-column ≤768px (Req 14.x).
//
// The api/client module is mocked so the view renders against controlled data; the
// WorkspaceForbiddenError class is provided by the mock so the component's `instanceof`
// branch (its 403 → access-denied path) is exercised against the same class the test
// constructs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { LanguageProvider } from '../i18n/context';
import { WorkspaceDetailView } from './WorkspaceDetailView';
import type { Annotation, CollectionItemEntry, Membership, SharedCollection } from '../api/types';

expect.extend(axeMatchers);

// Hoisted mock surface. WorkspaceForbiddenError is a real class defined here so both the
// component (via the mocked module) and this test reference the same constructor — the
// component's `e instanceof WorkspaceForbiddenError` 403 branch depends on it.
const api = vi.hoisted(() => {
  class WorkspaceForbiddenError extends Error {
    constructor(message = 'You do not have access to this workspace.') {
      super(message);
      this.name = 'WorkspaceForbiddenError';
    }
  }
  return {
    WorkspaceForbiddenError,
    listMembers: vi.fn(),
    listCollections: vi.fn(),
    listCollectionItems: vi.fn(),
    listAnnotations: vi.fn(),
    createCollection: vi.fn(),
    createAnnotation: vi.fn(),
    addCollectionItem: vi.fn(),
    removeCollectionItem: vi.fn(),
    deleteCollection: vi.fn(),
    removeMember: vi.fn(),
    editAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
  };
});

vi.mock('../api/client', () => ({
  WorkspaceForbiddenError: api.WorkspaceForbiddenError,
  listMembers: api.listMembers,
  listCollections: api.listCollections,
  listCollectionItems: api.listCollectionItems,
  listAnnotations: api.listAnnotations,
  createCollection: api.createCollection,
  createAnnotation: api.createAnnotation,
  addCollectionItem: api.addCollectionItem,
  removeCollectionItem: api.removeCollectionItem,
  deleteCollection: api.deleteCollection,
  removeMember: api.removeMember,
  editAnnotation: api.editAnnotation,
  deleteAnnotation: api.deleteAnnotation,
}));

const TOKEN = 'test-access-token';
const WORKSPACE_ID = 'ws-1';
const OWNER_ID = 'reader-owner';

const MEMBERS: Membership[] = [
  { readerId: OWNER_ID, role: 'owner' },
  { readerId: 'reader-member', role: 'member' },
];
const COLLECTION: SharedCollection = { id: 'col-1', name: 'Week One Readings' };

// Items supplied already newest-first (addedAt DESC); the view renders in returned order.
const ITEMS: CollectionItemEntry[] = [
  { reportId: 'report-newest', addedAt: '2024-06-03T00:00:00.000Z' },
  { reportId: 'report-middle', addedAt: '2024-06-02T00:00:00.000Z' },
  { reportId: 'report-oldest', addedAt: '2024-06-01T00:00:00.000Z' },
];

// Annotations supplied newest-first (createdAt DESC); distinct authors so attribution
// is visible. Texts are unique markers so DOM order is unambiguous.
const ANNOTATIONS: Annotation[] = [
  {
    id: 'ann-3',
    workspaceId: WORKSPACE_ID,
    reportId: 'report-newest',
    authorId: 'reader-member',
    text: 'note-newest',
    createdAt: '2024-07-03T00:00:00.000Z',
    updatedAt: '2024-07-03T00:00:00.000Z',
  },
  {
    id: 'ann-2',
    workspaceId: WORKSPACE_ID,
    reportId: 'report-newest',
    authorId: OWNER_ID,
    text: 'note-middle',
    createdAt: '2024-07-02T00:00:00.000Z',
    updatedAt: '2024-07-02T00:00:00.000Z',
  },
  {
    id: 'ann-1',
    workspaceId: WORKSPACE_ID,
    reportId: 'report-newest',
    authorId: 'reader-member',
    text: 'note-oldest',
    createdAt: '2024-07-01T00:00:00.000Z',
    updatedAt: '2024-07-01T00:00:00.000Z',
  },
];

function renderDetail(overrides: Partial<Parameters<typeof WorkspaceDetailView>[0]> = {}) {
  const onBack = vi.fn();
  const onForbidden = vi.fn();
  const onAuthError = vi.fn();
  const utils = render(
    <LanguageProvider>
    <WorkspaceDetailView
      workspaceId={WORKSPACE_ID}
      token={TOKEN}
      currentReaderId={OWNER_ID}
      workspaceName="Pilot Workspace"
      onBack={onBack}
      onForbidden={onForbidden}
      onAuthError={onAuthError}
      {...overrides}
    />
    </LanguageProvider>,
  );
  return { ...utils, onBack, onForbidden, onAuthError };
}

beforeEach(() => {
  api.listMembers.mockReset().mockResolvedValue(MEMBERS);
  api.listCollections.mockReset().mockResolvedValue([COLLECTION]);
  api.listCollectionItems.mockReset().mockResolvedValue(ITEMS);
  api.listAnnotations.mockReset().mockResolvedValue(ANNOTATIONS);
  api.createCollection.mockReset();
  api.createAnnotation.mockReset();
  api.addCollectionItem.mockReset().mockResolvedValue(undefined);
  api.removeCollectionItem.mockReset().mockResolvedValue(undefined);
  api.deleteCollection.mockReset().mockResolvedValue(undefined);
  api.removeMember.mockReset().mockResolvedValue(undefined);
  api.editAnnotation.mockReset().mockResolvedValue(undefined);
  api.deleteAnnotation.mockReset().mockResolvedValue(undefined);
});

describe('WorkspaceDetailView', () => {
  // Members + collections render from mocked data with the token attached.
  it('renders members and collections from loaded data', async () => {
    renderDetail();

    await waitFor(() => expect(api.listMembers).toHaveBeenCalledWith(WORKSPACE_ID, TOKEN));
    expect(api.listCollections).toHaveBeenCalledWith(WORKSPACE_ID, TOKEN);

    expect(await screen.findByText(OWNER_ID)).toBeInTheDocument();
    expect(screen.getByText('reader-member')).toBeInTheDocument();
    expect(screen.getByText(COLLECTION.name)).toBeInTheDocument();
  });

  // 6.4 — collection items render newest-first in the server-provided order.
  it('renders collection items newest-first (Req 6.4)', async () => {
    renderDetail();

    await screen.findByText('report-newest');
    const rendered = screen
      .getAllByText(/^report-(newest|middle|oldest)$/)
      .map((el) => el.textContent);
    expect(rendered).toEqual(['report-newest', 'report-middle', 'report-oldest']);
  });

  // Creating a collection updates the list without a reload.
  it('adds a created collection to the list', async () => {
    api.createCollection.mockResolvedValue({ id: 'col-2', name: 'Week Two Readings' });
    renderDetail();
    const user = userEvent.setup();

    await screen.findByText(COLLECTION.name);
    await user.type(
      screen.getByRole('textbox', { name: /new collection name/i }),
      'Week Two Readings',
    );
    await user.click(screen.getByRole('button', { name: /create collection/i }));

    expect(api.createCollection).toHaveBeenCalledWith(WORKSPACE_ID, 'Week Two Readings', TOKEN);
    expect(await screen.findByText('Week Two Readings')).toBeInTheDocument();
  });

  // 7.2 — annotations render newest-first, each shown as an author-attributed note.
  it('renders annotations newest-first as attributed notes (Req 7.2, 10.6)', async () => {
    renderDetail();
    const user = userEvent.setup();

    // Reveal the notes panel for the first report item (loads its annotations).
    const notesBtn = await screen.findByRole('button', {
      name: /show notes for report report-newest/i,
    });
    await user.click(notesBtn);

    await screen.findByText('note-newest');
    const rendered = screen.getAllByText(/^note-(newest|middle|oldest)$/).map((el) => el.textContent);
    expect(rendered).toEqual(['note-newest', 'note-middle', 'note-oldest']);

    // Each annotation is attributed to its authoring reader AS A NOTE (never a verdict).
    expect(screen.getAllByText(/note by reader-member/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(new RegExp(`note by ${OWNER_ID}`, 'i'))).toBeInTheDocument();
  });

  // Creating an annotation prepends it to the (newest-first) list.
  it('prepends a created annotation to the notes list', async () => {
    api.createAnnotation.mockResolvedValue({
      id: 'ann-new',
      workspaceId: WORKSPACE_ID,
      reportId: 'report-newest',
      authorId: OWNER_ID,
      text: 'note-brand-new',
      createdAt: '2024-08-01T00:00:00.000Z',
      updatedAt: '2024-08-01T00:00:00.000Z',
    });
    renderDetail();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: /show notes for report report-newest/i }),
    );
    await screen.findByText('note-newest');

    await user.type(screen.getByRole('textbox', { name: /add a note to report report-newest/i }), 'note-brand-new');
    await user.click(screen.getByRole('button', { name: /^add note$/i }));

    expect(api.createAnnotation).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'report-newest',
      'note-brand-new',
      TOKEN,
    );
    // The new note renders ahead of the previously-newest note.
    await screen.findByText('note-brand-new');
    const rendered = screen
      .getAllByText(/^note-(brand-new|newest|middle|oldest)$/)
      .map((el) => el.textContent);
    expect(rendered[0]).toBe('note-brand-new');
  });

  // 13.6 — a 403 shows the access-denied message and renders NO workspace data.
  it('shows the access-denied message and no data on a 403 (Req 13.6)', async () => {
    api.listMembers.mockRejectedValue(new api.WorkspaceForbiddenError());
    api.listCollections.mockRejectedValue(new api.WorkspaceForbiddenError());
    const { onForbidden } = renderDetail();

    expect(await screen.findByText(/you do not have access to this workspace/i)).toBeInTheDocument();
    expect(onForbidden).toHaveBeenCalled();
    // No workspace data is presented.
    expect(screen.queryByText(COLLECTION.name)).not.toBeInTheDocument();
    expect(screen.queryByText('reader-member')).not.toBeInTheDocument();
  });

  // 10.1/10.2/10.3 — the detail surface renders only neutral references: no
  // content-truthfulness verdict, no creator-reliability rating, and no source-tier chip
  // (tiers attach to a source/citation in the full report view, never on this surface).
  it('renders no verdict, no creator rating, and no source-tier chip (Req 10.1, 10.2, 10.3)', async () => {
    renderDetail();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /show notes for report report-newest/i }),
    );
    await screen.findByText('note-newest');

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(
      /\btrue\b|\bfalse\b|verdict|misleading|reliability rating|credibility score|creator rating/i,
    );
    // No source-reliability tier is rendered on this surface.
    expect(text).not.toMatch(/tier\s*1|tier\s*2|tier\s*3|tier1_primary|tier2_institutional/i);
  });

  // 14.8 — status flows through a polite ARIA live region.
  it('announces status through an ARIA live region (Req 14.8)', async () => {
    const { container } = renderDetail();
    const live = container.querySelector('.sr-only[role="status"][aria-live="polite"]');
    expect(live).not.toBeNull();
    await waitFor(() => expect(live).toHaveTextContent(/loaded 2 members and 1 collection\./i));
  });

  // 14.3/14.7 — interactive controls carry accessible names + roles and are keyboard
  // reachable (receive focus).
  it('exposes accessible names and is keyboard reachable (Req 14.3, 14.7)', async () => {
    renderDetail();

    await screen.findByText(COLLECTION.name);
    const refreshBtn = screen.getByRole('button', { name: /refresh this workspace/i });
    expect(screen.getByRole('button', { name: /back to your workspaces/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create collection/i })).toBeInTheDocument();
    // Owner-only member removal control carries a descriptive accessible name.
    expect(screen.getByRole('button', { name: /remove member reader-member/i })).toBeInTheDocument();

    refreshBtn.focus();
    expect(refreshBtn).toHaveFocus();
  });

  // 14.1/14.3 — axe finds no WCAG A/AA ARIA-wiring violations on the loaded surface.
  it('has no axe violations on the loaded workspace (Req 14.1, 14.3)', async () => {
    const { container } = renderDetail();
    await screen.findByText(COLLECTION.name);

    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});

// 14.4 — single column at 200–768px. jsdom cannot compute layout; assert the media-query
// rule exists and the surface uses the shared single-column .mini-card cards.
describe('WorkspaceDetailView responsive layout (Req 14.4)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(HERE, '../styles.css'), 'utf8');

  it('defines the ≤768px single-column media query', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)/);
  });

  it('renders sections inside the shared single-column .mini-card class', async () => {
    const { container } = renderDetail();
    await screen.findByText(COLLECTION.name);
    expect(container.querySelector('.mini-card')).not.toBeNull();
  });
});
