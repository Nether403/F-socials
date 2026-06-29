import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Crown,
  FolderPlus,
  Inbox,
  Lock,
  Plus,
  RefreshCw,
  Ticket,
  User,
  Users,
} from 'lucide-react';
import { createWorkspace, listWorkspaces, redeemInvite } from '../api/client';
import type { WorkspaceRole, WorkspaceSummary } from '../api/types';

// Workspace_View list surface (#/workspaces) — lists the reader's Workspaces and
// offers a create-workspace form and a redeem-invite form.
//
// Compass: this is a lens, not a judge. A WorkspaceSummary carries only the
// workspace identifier, its name, and the reader's own role. The view renders NO
// content-truthfulness verdict and NO creator-reliability rating (Req 10.1, 10.2);
// any source-reliability tier lives on a full report's sources/citations, never
// here (Req 10.3).
//
// Accent is the muted teal #0d9488 (Req 14.5); icons come from lucide-react
// (Req 14.6); status messages are announced through an ARIA live region (Req 14.8);
// every color/icon is paired with an adjacent text label (Req 14.2); the layout is
// a single column at <=768px via .history-list / .history-entry (Req 14.4).
//
// Degraded path (Req 12.1, 12.3): when the app is not Auth_Configured the view shows
// the workspace-features-unavailable message and renders NEITHER the create form NOR
// the redeem form — so there is no control to activate and nothing is ever sent.

const ACCENT = '#0d9488';

// The workspace-list request must not hang the view: a load that does not complete
// within 10 seconds is surfaced as an error with a retry, never as the empty state.
const WORKSPACE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Loading your workspaces is taking too long. Please try again.')),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Defensive deterministic ordering (name ASC, then id ASC) mirroring the server's
// ORDER BY, so the list keeps a stable order across reloads regardless of input order.
function sortByName(entries: WorkspaceSummary[]): WorkspaceSummary[] {
  return [...entries].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function roleLabel(role: WorkspaceRole): string {
  return role === 'owner' ? 'Owner' : 'Member';
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: WorkspaceSummary[] }
  | { kind: 'error'; message: string };

export interface WorkspaceListViewProps {
  /**
   * Whether the app is Auth_Configured. When false, the view renders the
   * workspace-features-unavailable message and no create/redeem forms (Req 12.1).
   */
  isAuthConfigured: boolean;
  /**
   * The active Session access token; attached to every workspace request. Only
   * required when Auth_Configured and a session is active (the App routes anonymous
   * configured readers to sign-in before this view renders — task 9.1).
   */
  token?: string;
  /** Open the detail view for the selected workspace (#/workspaces/:id). */
  onOpenWorkspace: (workspaceId: string) => void;
  /** Optional back affordance to leave the workspace surface. */
  onBack?: () => void;
  /**
   * Pipe caught errors to the session layer so a 401 (AuthExpiredError) clears the
   * session and falls back to the Anonymous experience (Req 13.5). Non-401 errors are
   * ignored by the session layer and shown inline here.
   */
  onAuthError?: (error: unknown) => void;
}

export function WorkspaceListView({
  isAuthConfigured,
  token,
  onOpenWorkspace,
  onBack,
  onAuthError,
}: WorkspaceListViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Single polite live region content: load/create/redeem outcomes are announced
  // without requiring a focus change (Req 14.8).
  const [status, setStatus] = useState('');
  // On create-confirmation the new workspace is presented as selected (Req 1.5); the
  // selected row is also re-marked after redeeming an invite for the joined workspace.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    if (!token) {
      // No session token: nothing to load. Present an empty ready phase so the
      // create/redeem forms remain usable once a token arrives.
      setPhase({ kind: 'ready', entries: [] });
      return;
    }
    setPhase({ kind: 'loading' });
    setStatus('Loading your workspaces…');
    try {
      const entries = await withTimeout(listWorkspaces(token), WORKSPACE_TIMEOUT_MS);
      const sorted = sortByName(entries);
      setPhase({ kind: 'ready', entries: sorted });
      setStatus(
        sorted.length === 0
          ? 'You are not a member of any workspace yet.'
          : `Loaded ${sorted.length} workspace${sorted.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      onAuthError?.(e);
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      setStatus('');
    }
  }

  useEffect(() => {
    // Only load when configured; the degraded path renders the unavailable message
    // and issues no request (Req 12.1, 12.3).
    if (isAuthConfigured) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthConfigured, token]);

  // Create-confirmation: merge the new workspace into the list, mark it selected, and
  // list the reader as its owner (Req 1.5).
  function handleCreated(ws: WorkspaceSummary) {
    setPhase((p) => {
      const existing = p.kind === 'ready' ? p.entries.filter((e) => e.id !== ws.id) : [];
      return { kind: 'ready', entries: sortByName([...existing, ws]) };
    });
    setSelectedId(ws.id);
    setStatus(`Workspace "${ws.name}" created. You are listed as ${roleLabel(ws.role)}.`);
  }

  // Redeem-confirmation: the redeem response carries only the workspace id + role, so
  // reload the list to pick up the joined workspace's name, then select it.
  async function handleJoined(workspaceId: string) {
    setSelectedId(workspaceId);
    setStatus('Invite redeemed. You joined the workspace.');
    await load();
  }

  function back() {
    if (onBack) onBack();
    else if (window.location.hash) window.location.hash = '';
  }

  return (
    <div className="history-view">
      <div className="report-head">
        <div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={back}
            style={{ height: 34, padding: '0 12px' }}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <h2 className="editorial">
            <Users
              size={18}
              aria-hidden="true"
              style={{ color: ACCENT, verticalAlign: '-3px', marginRight: 6 }}
            />
            Workspaces
          </h2>
          <div className="meta-row">
            <span>Shared spaces where your group collects and discusses analyzed reports.</span>
          </div>
        </div>
        {isAuthConfigured && (
          <div className="head-actions">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
              onClick={() => void load()}
              disabled={phase.kind === 'loading'}
              aria-label="Refresh your workspaces"
            >
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
          </div>
        )}
      </div>

      {/* Visually-hidden polite live region for status announcements (Req 14.8). */}
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {/* Degraded path: workspace features unavailable, no create/redeem forms
          (Req 12.1, 12.3). */}
      {!isAuthConfigured && (
        <div
          className="mini-card"
          role="status"
          style={{ textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <Lock size={20} aria-hidden="true" style={{ marginBottom: 6 }} />
          <p style={{ margin: 0 }}>
            Workspace features are unavailable. Sign-in is not configured in this deployment,
            so shared workspaces cannot be created or joined here.
          </p>
        </div>
      )}

      {isAuthConfigured && (
        <>
          <div className="workspace-forms" style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
            <CreateWorkspaceForm token={token} onCreated={handleCreated} onAuthError={onAuthError} />
            <RedeemInviteForm token={token} onJoined={handleJoined} onAuthError={onAuthError} />
          </div>

          {phase.kind === 'loading' && (
            <div className="loading" role="status" aria-live="polite">
              <div className="spinner" />
              <div className="section-label">Loading your workspaces…</div>
            </div>
          )}

          {phase.kind === 'error' && (
            <div>
              <div className="banner error" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /> {phase.message}
              </div>
              <div className="error-actions">
                <button type="button" className="btn" onClick={() => void load()}>
                  <RefreshCw size={15} aria-hidden="true" /> Retry
                </button>
                <button type="button" className="btn btn-ghost" onClick={back}>
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Empty-state message + create offer at zero memberships (Req 4.5). The
              create control is the form above; this message points the reader to it. */}
          {phase.kind === 'ready' && phase.entries.length === 0 && (
            <div
              className="mini-card"
              role="status"
              style={{ textAlign: 'center', color: 'var(--text-muted)' }}
            >
              <Inbox size={20} aria-hidden="true" style={{ marginBottom: 6 }} />
              <p style={{ margin: 0 }}>
                You are not a member of any workspace yet. Create one above to start collecting
                and discussing reports with your group.
              </p>
            </div>
          )}

          {phase.kind === 'ready' && phase.entries.length > 0 && (
            <ul className="history-list" aria-label="Your workspaces">
              {phase.entries.map((ws) => (
                <WorkspaceRow
                  key={ws.id}
                  workspace={ws}
                  selected={ws.id === selectedId}
                  onOpenWorkspace={onOpenWorkspace}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// One workspace row: opens the detail view and shows the reader's role with a text
// label beside the icon (color-never-alone, Req 14.2). A selected row (the just-created
// or just-joined workspace) is marked with aria-current and a visible accent (Req 1.5).
function WorkspaceRow({
  workspace,
  selected,
  onOpenWorkspace,
}: {
  workspace: WorkspaceSummary;
  selected: boolean;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  return (
    <li
      className="mini-card history-entry"
      style={selected ? { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}` } : undefined}
    >
      <div className="history-entry-main">
        <button
          type="button"
          className="history-open"
          onClick={() => onOpenWorkspace(workspace.id)}
          aria-label={`Open workspace ${workspace.name}`}
          aria-current={selected ? 'true' : undefined}
        >
          <Users size={15} aria-hidden="true" />
          <span className="history-report-id">{workspace.name}</span>
        </button>
        <div className="history-saved-at" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {workspace.role === 'owner' ? (
            <Crown size={13} aria-hidden="true" style={{ color: ACCENT }} />
          ) : (
            <User size={13} aria-hidden="true" />
          )}
          {/* Role text always present beside the icon (Req 14.2). */}
          <span>Your role: {roleLabel(workspace.role)}</span>
          {selected && <span style={{ color: ACCENT }}>· Selected</span>}
        </div>
      </div>
    </li>
  );
}

// Create-workspace form. Owns its own busy/error state so a failed create leaves the
// input intact and the control operable for retry, without disturbing the list.
function CreateWorkspaceForm({
  token,
  onCreated,
  onAuthError,
}: {
  token?: string;
  onCreated: (ws: WorkspaceSummary) => void;
  onAuthError?: (error: unknown) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valid || !token) return;
    setBusy(true);
    setError(null);
    try {
      const ws = await createWorkspace(trimmed, token);
      onCreated(ws);
      setName('');
    } catch (err) {
      onAuthError?.(err);
      setError(
        err instanceof Error ? err.message : 'Creating the workspace did not complete. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mini-card" onSubmit={submit} aria-label="Create a workspace">
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <FolderPlus size={15} aria-hidden="true" style={{ color: ACCENT }} /> Create a workspace
      </h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <input
          className="auth-input"
          style={{ flex: 1, minWidth: 160, width: 'auto' }}
          type="text"
          value={name}
          maxLength={100}
          placeholder="Workspace name"
          aria-label="New workspace name"
          onChange={(ev) => setName(ev.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn"
          style={{ height: 38, padding: '0 14px' }}
          disabled={busy || !valid}
          aria-label="Create workspace"
        >
          <Plus size={15} aria-hidden="true" /> {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error && (
        <div className="banner error" role="alert" style={{ marginTop: 8 }}>
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}
    </form>
  );
}

// Redeem-invite form. Owns its own busy/error state, mirroring the create form.
function RedeemInviteForm({
  token,
  onJoined,
  onAuthError,
}: {
  token?: string;
  onJoined: (workspaceId: string) => void | Promise<void>;
  onAuthError?: (error: unknown) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = code.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 200;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valid || !token) return;
    setBusy(true);
    setError(null);
    try {
      const { workspaceId } = await redeemInvite(trimmed, token);
      setCode('');
      await onJoined(workspaceId);
    } catch (err) {
      onAuthError?.(err);
      setError(
        err instanceof Error ? err.message : 'Redeeming the invite did not complete. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mini-card" onSubmit={submit} aria-label="Redeem an invite">
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Ticket size={15} aria-hidden="true" style={{ color: ACCENT }} /> Join with an invite code
      </h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <input
          className="auth-input"
          style={{ flex: 1, minWidth: 160, width: 'auto' }}
          type="text"
          value={code}
          maxLength={200}
          placeholder="Invite code"
          aria-label="Invite code"
          onChange={(ev) => setCode(ev.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-ghost"
          style={{ height: 38, padding: '0 14px' }}
          disabled={busy || !valid}
          aria-label="Redeem invite"
        >
          <Ticket size={15} aria-hidden="true" /> {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {error && (
        <div className="banner error" role="alert" style={{ marginTop: 8 }}>
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}
    </form>
  );
}
