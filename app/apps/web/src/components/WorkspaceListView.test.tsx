// Feature: institutional-workspace, Workspace_View list-surface component tests (task 8.3)
// Validates: Requirements 1.5, 4.5, 10.1, 10.2, 12.1, 14.1, 14.2, 14.3, 14.4, 14.7, 14.8
//
// Example-based component coverage for WorkspaceListView: the create-workspace flow
// presents the new workspace as selected with the reader listed as Owner (Req 1.5);
// zero memberships shows the empty-state AND offers the create control (Req 4.5); when
// the app is not Auth_Configured the unavailable message renders and NO create/redeem
// forms appear (Req 12.1); neutrality — no truthfulness verdict, no creator-reliability
// rating (Req 10.1, 10.2); and accessibility — axe has no violations, every interactive
// control carries an accessible name + role and is keyboard reachable/activatable, a
// visible focus indicator exists, and status flows through an ARIA live region (Req 14.1,
// 14.2, 14.3, 14.7, 14.8) with a single-column ≤768px layout (Req 14.4).
//
// The api/client module is mocked so the view renders against controlled data and never
// hits the network; the three functions the component calls (listWorkspaces,
// createWorkspace, redeemInvite) are driven per test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { LanguageProvider } from '../i18n/context';
import { WorkspaceListView } from './WorkspaceListView';
import type { WorkspaceSummary } from '../api/types';

expect.extend(axeMatchers);

// Hoisted vi.fns so the mock factory and the assertions share the same instances.
const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn<(token: string) => Promise<WorkspaceSummary[]>>(),
  createWorkspace: vi.fn<(name: string, token: string) => Promise<WorkspaceSummary>>(),
  redeemInvite:
    vi.fn<(code: string, token: string) => Promise<{ workspaceId: string; role: WorkspaceSummary['role'] }>>(),
}));

vi.mock('../api/client', () => ({
  listWorkspaces: api.listWorkspaces,
  createWorkspace: api.createWorkspace,
  redeemInvite: api.redeemInvite,
}));

const TOKEN = 'test-access-token';

// Two memberships whose name ordering disagrees with id ordering, so a correct render
// proves name ASC drives the order (the view defensively re-sorts).
const OWNED: WorkspaceSummary = { id: 'zzz-1', name: 'Alpha Class', role: 'owner' };
const JOINED: WorkspaceSummary = { id: 'aaa-2', name: 'Beta Library', role: 'member' };

function renderList(overrides: Partial<Parameters<typeof WorkspaceListView>[0]> = {}) {
  const onOpenWorkspace = vi.fn();
  const onBack = vi.fn();
  const onAuthError = vi.fn();
  const utils = render(
    <LanguageProvider>
    <WorkspaceListView
      isAuthConfigured
      token={TOKEN}
      onOpenWorkspace={onOpenWorkspace}
      onBack={onBack}
      onAuthError={onAuthError}
      {...overrides}
    />
    </LanguageProvider>,
  );
  return { ...utils, onOpenWorkspace, onBack, onAuthError };
}

beforeEach(() => {
  api.listWorkspaces.mockReset().mockResolvedValue([]);
  api.createWorkspace.mockReset();
  api.redeemInvite.mockReset();
});

describe('WorkspaceListView', () => {
  // 4.5 — zero memberships shows the empty-state message AND offers the create control.
  it('shows the empty-state and still offers the create control at zero memberships (Req 4.5)', async () => {
    api.listWorkspaces.mockResolvedValue([]);
    renderList();

    // Match the empty-state paragraph's call-to-action (distinct from the live-region
    // status, which shares the leading sentence).
    expect(
      await screen.findByText(/create one above to start collecting/i),
    ).toBeInTheDocument();
    // The create control is offered even when empty (the empty-state points to it).
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /new workspace name/i })).toBeInTheDocument();
  });

  // 1.5 — on create-confirmation the new workspace is presented as selected and the
  // requesting reader is listed with the Owner role.
  it('presents the created workspace as selected with the reader as Owner (Req 1.5)', async () => {
    api.listWorkspaces.mockResolvedValue([]);
    api.createWorkspace.mockResolvedValue({ id: 'ws-new', name: 'My Class', role: 'owner' });
    renderList();
    const user = userEvent.setup();

    await screen.findByText(/create one above to start collecting/i);
    await user.type(screen.getByRole('textbox', { name: /new workspace name/i }), 'My Class');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(api.createWorkspace).toHaveBeenCalledWith('My Class', TOKEN);

    // The new workspace row is rendered, marked selected (aria-current), and shows the
    // reader's Owner role beside the icon (color-never-alone text).
    const openBtn = await screen.findByRole('button', { name: /open workspace my class/i });
    expect(openBtn).toHaveAttribute('aria-current', 'true');
    const row = openBtn.closest('li')!;
    expect(within(row).getByText(/your role: owner/i)).toBeInTheDocument();
    expect(within(row).getByText(/selected/i)).toBeInTheDocument();
  });

  // 14.1 — the create control is activatable from the keyboard: pressing Enter in the
  // name field submits the form (the input and button are real <input>/<button>).
  it('creates a workspace via keyboard activation (Enter) (Req 14.1)', async () => {
    api.createWorkspace.mockResolvedValue({ id: 'ws-kb', name: 'Keyboard Class', role: 'owner' });
    renderList();
    const user = userEvent.setup();

    const input = await screen.findByRole('textbox', { name: /new workspace name/i });
    await user.type(input, 'Keyboard Class{Enter}');
    await waitFor(() => expect(api.createWorkspace).toHaveBeenCalledWith('Keyboard Class', TOKEN));
  });

  // 12.1 — when not Auth_Configured the unavailable message renders and NEITHER the
  // create form NOR the redeem form is present, so no control can send a request.
  it('renders the unavailable message and no create/redeem forms when not configured (Req 12.1)', async () => {
    renderList({ isAuthConfigured: false, token: undefined });

    expect(await screen.findByText(/workspace features are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /new workspace name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem invite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /invite code/i })).not.toBeInTheDocument();
    // No request is ever issued on the degraded path.
    expect(api.listWorkspaces).not.toHaveBeenCalled();
  });

  // 10.1/10.2 — the list surface renders only neutral name + role association data: no
  // content-truthfulness verdict and no creator-reliability rating.
  it('renders no verdict and no creator rating (Req 10.1, 10.2)', async () => {
    api.listWorkspaces.mockResolvedValue([OWNED, JOINED]);
    const { container } = renderList();

    await screen.findByText(OWNED.name);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(
      /\btrue\b|\bfalse\b|verdict|misleading|reliability rating|credibility score|creator rating/i,
    );
  });

  // 14.8 — status messages flow through a polite ARIA live region so assistive tech
  // announces them without a focus change.
  it('announces status through an ARIA live region (Req 14.8)', async () => {
    api.listWorkspaces.mockResolvedValue([OWNED]);
    const { container } = renderList();

    const live = container.querySelector('.sr-only[role="status"][aria-live="polite"]');
    expect(live).not.toBeNull();
    await waitFor(() => expect(live).toHaveTextContent(/loaded 1 workspace\./i));
  });

  // 14.3/14.7 — every interactive control has an accessible name + role, and a control
  // is keyboard-reachable (receives focus). The workspace-open button carries a
  // visible focus indicator via the shared .history-open:focus-visible rule (asserted
  // structurally below).
  it('exposes accessible names and is keyboard reachable (Req 14.3, 14.7)', async () => {
    api.listWorkspaces.mockResolvedValue([OWNED]);
    renderList();
    const user = userEvent.setup();

    const openBtn = await screen.findByRole('button', { name: /open workspace alpha class/i });
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /redeem invite/i })).toBeInTheDocument();

    openBtn.focus();
    expect(openBtn).toHaveFocus();
    // Tab moves focus to a subsequent interactive control (sequential focus order).
    await user.tab();
    expect(openBtn).not.toHaveFocus();
  });

  // 14.1/14.3 — axe finds no WCAG A/AA ARIA-wiring violations on a populated list.
  it('has no axe violations on a populated list (Req 14.1, 14.3)', async () => {
    api.listWorkspaces.mockResolvedValue([OWNED, JOINED]);
    const { container } = renderList();
    await screen.findByText(OWNED.name);

    // jsdom cannot measure real contrast, so color-contrast is excluded (covered by the
    // CSS-variable audit + manual review), mirroring the a11y smoke precedent.
    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});

// 14.4 — at 200–768px the list surface presents one column. jsdom cannot compute layout,
// so this is a static assertion against the media-query rule that collapses each entry's
// row to a single column, plus a structural check that the surface uses the shared
// single-column card classes.
describe('WorkspaceListView responsive layout (Req 14.4)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(HERE, '../styles.css'), 'utf8');

  it('stacks workspace entries into one column at ≤768px', () => {
    const mediaBlock = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? '';
    const entryRule = /\.history-entry\s*\{([^}]*)\}/.exec(mediaBlock)?.[1] ?? '';
    expect(entryRule).toMatch(/flex-direction:\s*column/);
  });

  it('renders rows inside the shared single-column .history-list / .mini-card classes', async () => {
    api.listWorkspaces.mockResolvedValue([OWNED]);
    const { container } = renderList();
    await screen.findByText(OWNED.name);
    expect(container.querySelector('ul.history-list')).not.toBeNull();
    expect(container.querySelector('li.mini-card')).not.toBeNull();
  });

  it('defines a visible focus indicator for the workspace-open control', () => {
    expect(css).toMatch(/\.history-open:focus-visible\s*\{[^}]*outline:/);
  });
});
