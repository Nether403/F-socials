import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  WorkspaceForbiddenError,
  addCollectionItem,
  createAnnotation,
  createCollection,
  deleteAnnotation,
  deleteCollection,
  editAnnotation,
  listAnnotations,
  listCollectionItems,
  listCollections,
  listMembers,
  removeCollectionItem,
  removeMember,
} from '../api/client';
import type {
  Annotation,
  CollectionItemEntry,
  Membership,
  SharedCollection,
  WorkspaceRole,
} from '../api/types';

// Workspace_Detail_View (#/workspaces/:id) — members, shared collections, collection
// items, and classroom annotations for a single workspace the reader belongs to.
//
// Compass: this is a lens, not a judge. The view renders report references (by id),
// annotation text (attributed to its authoring reader AS A NOTE, never a verdict or a
// rating), member subjects + roles, and collection names ONLY. It displays NO
// content-truthfulness verdict and NO creator-reliability rating (Req 10.1, 10.2, 10.6).
// Any source-reliability tier lives on a source/citation inside the full report view,
// never here — this surface references reports by id, so no tier is rendered (Req 10.3).
//
// A 403 (WorkspaceForbiddenError) shows the access-denied message and renders NO
// workspace data (Req 13.6). Accent is the muted teal #0d9488 (Req 14.5); icons come
// from lucide-react (Req 14.6); status messages are announced through an ARIA live
// region (Req 14.8); every color/icon is paired with an adjacent text label (Req 14.2);
// every control carries an accessible name + role (Req 14.3) with a visible focus
// indicator (Req 14.7); the layout is a single column via the shared .mini-card classes
// at 200–768px (Req 14.4).

const ACCENT = '#0d9488';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; members: Membership[]; collections: SharedCollection[]; role: WorkspaceRole }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export interface WorkspaceDetailViewProps {
  /** The workspace whose members, collections, and annotations are shown. */
  workspaceId: string;
  /** The active Session access token; attached to every workspace request (Req 13.2). */
  token: string;
  /** The signed-in reader's JWT subject; used to decide author-or-owner controls. */
  currentReaderId: string;
  /** Optional display name; falls back to the workspace id when absent. */
  workspaceName?: string;
  /** Optional back affordance to leave the detail surface. */
  onBack?: () => void;
  /** Called when a workspace call returns 403, so the router can react (Req 13.6). */
  onForbidden?: () => void;
  /**
   * Pipe caught errors to the session layer so a 401 (AuthExpiredError) clears the
   * session and falls back to the Anonymous experience (Req 13.5). Non-401 errors are
   * shown inline here.
   */
  onAuthError?: (error: unknown) => void;
}

export function WorkspaceDetailView({
  workspaceId,
  token,
  currentReaderId,
  workspaceName,
  onBack,
  onForbidden,
  onAuthError,
}: WorkspaceDetailViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [status, setStatus] = useState('');

  async function load() {
    setPhase({ kind: 'loading' });
    setStatus('Loading the workspace…');
    try {
      const [members, collections] = await Promise.all([
        listMembers(workspaceId, token),
        listCollections(workspaceId, token),
      ]);
      // The reader's own role decides which controls show; derive it from the member
      // list (the reader is, by construction of a 200, a member of this workspace).
      const role = members.find((m) => m.readerId === currentReaderId)?.role ?? 'member';
      setPhase({ kind: 'ready', members, collections, role });
      setStatus(
        `Loaded ${members.length} member${members.length === 1 ? '' : 's'} and ` +
          `${collections.length} collection${collections.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      onAuthError?.(e);
      if (e instanceof WorkspaceForbiddenError) {
        onForbidden?.();
        setPhase({ kind: 'forbidden' });
        setStatus('');
        return;
      }
      setPhase({ kind: 'error', message: errMessage(e, 'Could not load the workspace.') });
      setStatus('');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, token]);

  function back() {
    if (onBack) onBack();
    else if (window.location.hash) window.location.hash = '#/workspaces';
  }

  const isOwner = phase.kind === 'ready' && phase.role === 'owner';

  return (
    <div className="workspace-detail-view">
      <div className="report-head">
        <div>
          <button
            className="btn btn-ghost"
            onClick={back}
            style={{ height: 34, padding: '0 12px' }}
            aria-label="Back to your workspaces"
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <h2 className="editorial">
            <Users
              size={18}
              aria-hidden="true"
              style={{ color: ACCENT, verticalAlign: '-3px', marginRight: 6 }}
            />
            {workspaceName ?? 'Workspace'}
          </h2>
          <div className="meta-row">
            <span>
              Shared members, collections, and notes
              {phase.kind === 'ready' ? ` — you are ${phase.role === 'owner' ? 'an owner' : 'a member'}` : ''}.
            </span>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-ghost"
            style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
            onClick={() => void load()}
            disabled={phase.kind === 'loading'}
            aria-label="Refresh this workspace"
          >
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {/* Visually-hidden polite live region for status announcements (Req 14.8). */}
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {phase.kind === 'loading' && (
        <div className="loading" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="section-label">Loading the workspace…</div>
        </div>
      )}

      {/* A 403 shows the access-denied message and NO workspace data (Req 13.6). */}
      {phase.kind === 'forbidden' && (
        <div
          className="mini-card"
          role="alert"
          style={{ textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <ShieldAlert size={20} aria-hidden="true" style={{ marginBottom: 6 }} />
          <p style={{ margin: 0 }}>
            You do not have access to this workspace. Ask an owner for an invite to join.
          </p>
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <div className="banner error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" /> {phase.message}
          </div>
          <div className="error-actions">
            <button className="btn" onClick={() => void load()}>
              <RefreshCw size={15} aria-hidden="true" /> Retry
            </button>
            <button className="btn btn-ghost" onClick={back}>
              Back
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'ready' && (
        <>
          <MembersSection
            members={phase.members}
            isOwner={isOwner}
            currentReaderId={currentReaderId}
            workspaceId={workspaceId}
            token={token}
            onAuthError={onAuthError}
            announce={setStatus}
          />
          <CollectionsSection
            collections={phase.collections}
            isOwner={isOwner}
            currentReaderId={currentReaderId}
            workspaceId={workspaceId}
            token={token}
            onAuthError={onAuthError}
            announce={setStatus}
          />
        </>
      )}
    </div>
  );
}

// --- Members ----------------------------------------------------------------

function MembersSection({
  members,
  isOwner,
  currentReaderId,
  workspaceId,
  token,
  onAuthError,
  announce,
}: {
  members: Membership[];
  isOwner: boolean;
  currentReaderId: string;
  workspaceId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  announce: (message: string) => void;
}) {
  const [rows, setRows] = useState<Membership[]>(members);

  useEffect(() => setRows(members), [members]);

  function handleRemoved(readerId: string) {
    setRows((r) => r.filter((m) => m.readerId !== readerId));
    announce('Member removed from the workspace.');
  }

  return (
    <section aria-label="Members" style={{ marginTop: 18 }}>
      <h3 className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Users size={15} aria-hidden="true" style={{ color: ACCENT }} /> Members ({rows.length})
      </h3>
      <ul className="workspace-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((m) => (
          <MemberRow
            key={m.readerId}
            member={m}
            // The owner cannot remove their own membership (Req 3.4); hide the control.
            canRemove={isOwner && m.role !== 'owner' && m.readerId !== currentReaderId}
            workspaceId={workspaceId}
            token={token}
            onAuthError={onAuthError}
            onRemoved={handleRemoved}
          />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  member,
  canRemove,
  workspaceId,
  token,
  onAuthError,
  onRemoved,
}: {
  member: Membership;
  canRemove: boolean;
  workspaceId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  onRemoved: (readerId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeMember(workspaceId, member.readerId, token);
      onRemoved(member.readerId);
    } catch (e) {
      onAuthError?.(e);
      setError(errMessage(e, 'The removal did not complete. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <li className="mini-card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{member.readerId}</span>
      {/* Role is text, never color-only (Req 14.2). */}
      <span
        className="section-label"
        style={{
          border: `1px solid ${ACCENT}`,
          color: ACCENT,
          borderRadius: 4,
          padding: '1px 8px',
          fontSize: 12,
        }}
      >
        {member.role === 'owner' ? 'Owner' : 'Member'}
      </span>
      {canRemove && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 32, padding: '0 10px' }}
          onClick={() => void remove()}
          disabled={busy}
          aria-label={`Remove member ${member.readerId}`}
        >
          <UserMinus size={14} aria-hidden="true" /> {busy ? 'Removing…' : 'Remove'}
        </button>
      )}
      {error && (
        <div className="banner error" role="alert" style={{ flexBasis: '100%' }}>
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}
    </li>
  );
}

// --- Collections ------------------------------------------------------------

function CollectionsSection({
  collections,
  isOwner,
  currentReaderId,
  workspaceId,
  token,
  onAuthError,
  announce,
}: {
  collections: SharedCollection[];
  isOwner: boolean;
  currentReaderId: string;
  workspaceId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  announce: (message: string) => void;
}) {
  const [rows, setRows] = useState<SharedCollection[]>(collections);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRows(collections), [collections]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCollection(workspaceId, trimmed, token);
      setRows((r) => [...r, created]);
      setName('');
      announce(`Collection "${created.name}" created.`);
    } catch (err) {
      onAuthError?.(err);
      setError(errMessage(err, 'Could not create the collection. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function handleDeleted(collectionId: string) {
    setRows((r) => r.filter((c) => c.id !== collectionId));
    announce('Collection deleted.');
  }

  return (
    <section aria-label="Shared collections" style={{ marginTop: 22 }}>
      <h3 className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Folder size={15} aria-hidden="true" style={{ color: ACCENT }} /> Collections ({rows.length})
      </h3>

      <form onSubmit={create} style={{ display: 'flex', gap: 8, margin: '8px 0 12px', flexWrap: 'wrap' }}>
        <label className="sr-only" htmlFor="new-collection-name">
          New collection name
        </label>
        <input
          id="new-collection-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection name"
          maxLength={100}
          style={{ flex: 1, minWidth: 160 }}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn"
          disabled={busy || name.trim().length === 0}
          aria-label="Create collection"
        >
          <FolderPlus size={15} aria-hidden="true" /> {busy ? 'Creating…' : 'Create'}
        </button>
      </form>

      {error && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mini-card" role="status" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <Inbox size={18} aria-hidden="true" style={{ marginBottom: 6 }} />
          <p style={{ margin: 0 }}>No collections yet. Create one to start curating reports.</p>
        </div>
      ) : (
        <ul className="workspace-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              isOwner={isOwner}
              currentReaderId={currentReaderId}
              workspaceId={workspaceId}
              token={token}
              onAuthError={onAuthError}
              onDeleted={handleDeleted}
              announce={announce}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CollectionCard({
  collection,
  isOwner,
  currentReaderId,
  workspaceId,
  token,
  onAuthError,
  onDeleted,
  announce,
}: {
  collection: SharedCollection;
  isOwner: boolean;
  currentReaderId: string;
  workspaceId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  onDeleted: (collectionId: string) => void;
  announce: (message: string) => void;
}) {
  const [items, setItems] = useState<CollectionItemEntry[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [reportId, setReportId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadItems() {
    setLoadingItems(true);
    setItemsError(null);
    try {
      // Server returns items newest-first (addedAt DESC); render in returned order (Req 6.4).
      const fetched = await listCollectionItems(workspaceId, collection.id, token);
      setItems(fetched);
    } catch (e) {
      onAuthError?.(e);
      setItemsError(errMessage(e, 'Could not load this collection’s reports.'));
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reportId.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await addCollectionItem(workspaceId, collection.id, trimmed, token);
      setReportId('');
      announce('Report added to the collection.');
      await loadItems(); // re-fetch to keep the server's newest-first order
    } catch (err) {
      onAuthError?.(err);
      setAddError(errMessage(err, 'Could not add that report. Check the report id and try again.'));
    } finally {
      setAdding(false);
    }
  }

  function handleItemRemoved(removedReportId: string) {
    setItems((cur) => (cur ? cur.filter((i) => i.reportId !== removedReportId) : cur));
    announce('Report removed from the collection.');
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCollection(workspaceId, collection.id, token);
      onDeleted(collection.id);
    } catch (e) {
      onAuthError?.(e);
      setDeleteError(errMessage(e, 'Could not delete the collection. Please try again.'));
      setDeleting(false);
    }
  }

  return (
    <li className="mini-card" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Folder size={15} aria-hidden="true" style={{ color: ACCENT }} />
        <strong style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{collection.name}</strong>
        {isOwner && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 32, padding: '0 10px' }}
            onClick={() => void remove()}
            disabled={deleting}
            aria-label={`Delete collection ${collection.name}`}
          >
            <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>

      {deleteError && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {deleteError}
        </div>
      )}

      <form onSubmit={addItem} style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <label className="sr-only" htmlFor={`add-report-${collection.id}`}>
          Report id to add to {collection.name}
        </label>
        <input
          id={`add-report-${collection.id}`}
          type="text"
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          placeholder="Report id to add"
          style={{ flex: 1, minWidth: 160 }}
          disabled={adding}
        />
        <button
          type="submit"
          className="btn"
          disabled={adding || reportId.trim().length === 0}
          aria-label={`Add report to ${collection.name}`}
        >
          <Plus size={15} aria-hidden="true" /> {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {addError && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {addError}
        </div>
      )}

      {loadingItems && <div className="section-label">Loading reports…</div>}

      {itemsError && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {itemsError}
        </div>
      )}

      {items && items.length === 0 && !loadingItems && (
        <p className="section-label" style={{ color: 'var(--text-muted)' }}>
          No reports in this collection yet.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="workspace-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((item) => (
            <CollectionItemRow
              key={item.reportId}
              item={item}
              isOwner={isOwner}
              currentReaderId={currentReaderId}
              workspaceId={workspaceId}
              collectionId={collection.id}
              token={token}
              onAuthError={onAuthError}
              onRemoved={handleItemRemoved}
              announce={announce}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CollectionItemRow({
  item,
  isOwner,
  currentReaderId,
  workspaceId,
  collectionId,
  token,
  onAuthError,
  onRemoved,
  announce,
}: {
  item: CollectionItemEntry;
  isOwner: boolean;
  currentReaderId: string;
  workspaceId: string;
  collectionId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  onRemoved: (reportId: string) => void;
  announce: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeCollectionItem(workspaceId, collectionId, item.reportId, token);
      onRemoved(item.reportId);
    } catch (e) {
      onAuthError?.(e);
      setError(errMessage(e, 'Could not remove that report. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <li
      className="mini-card"
      style={{ display: 'block', background: 'var(--surface-2, transparent)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <FileText size={14} aria-hidden="true" style={{ color: ACCENT }} />
        {/* Report reference by id only — no verdict, no tier (Req 10.1, 10.3). */}
        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{item.reportId}</span>
        <span className="section-label" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Added {formatTime(item.addedAt)}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 32, padding: '0 10px' }}
          onClick={() => setShowNotes((s) => !s)}
          aria-expanded={showNotes}
          aria-label={`${showNotes ? 'Hide' : 'Show'} notes for report ${item.reportId}`}
        >
          <MessageSquare size={14} aria-hidden="true" /> Notes
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 32, padding: '0 10px' }}
          onClick={() => void remove()}
          disabled={busy}
          aria-label={`Remove report ${item.reportId} from the collection`}
        >
          <Trash2 size={14} aria-hidden="true" /> {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}

      {showNotes && (
        <AnnotationsPanel
          workspaceId={workspaceId}
          reportId={item.reportId}
          isOwner={isOwner}
          currentReaderId={currentReaderId}
          token={token}
          onAuthError={onAuthError}
          announce={announce}
        />
      )}
    </li>
  );
}

// --- Annotations (a report's classroom notes, newest-first) -----------------

function AnnotationsPanel({
  workspaceId,
  reportId,
  isOwner,
  currentReaderId,
  token,
  onAuthError,
  announce,
}: {
  workspaceId: string;
  reportId: string;
  isOwner: boolean;
  currentReaderId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  announce: (message: string) => void;
}) {
  const [notes, setNotes] = useState<Annotation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Server returns annotations newest-first (createdAt DESC); render as returned (Req 7.2).
      const fetched = await listAnnotations(workspaceId, reportId, token);
      setNotes(fetched);
    } catch (e) {
      onAuthError?.(e);
      setLoadError(errMessage(e, 'Could not load notes for this report.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, reportId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createAnnotation(workspaceId, reportId, trimmed, token);
      setNotes((cur) => [created, ...(cur ?? [])]);
      setText('');
      announce('Note added.');
    } catch (err) {
      onAuthError?.(err);
      setCreateError(errMessage(err, 'Could not add the note. Please try again.'));
    } finally {
      setCreating(false);
    }
  }

  function handleUpdated(updated: Annotation) {
    setNotes((cur) => (cur ? cur.map((n) => (n.id === updated.id ? updated : n)) : cur));
    announce('Note updated.');
  }

  function handleDeleted(annotationId: string) {
    setNotes((cur) => (cur ? cur.filter((n) => n.id !== annotationId) : cur));
    announce('Note deleted.');
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 10 }}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
        <label className="sr-only" htmlFor={`note-${reportId}`}>
          Add a note to report {reportId}
        </label>
        <textarea
          id={`note-${reportId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note for your group…"
          maxLength={4000}
          rows={2}
          disabled={creating}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <div>
          <button
            type="submit"
            className="btn"
            disabled={creating || text.trim().length === 0}
            aria-label="Add note"
          >
            <Plus size={15} aria-hidden="true" /> {creating ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </form>

      {createError && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {createError}
        </div>
      )}

      {loading && <div className="section-label">Loading notes…</div>}

      {loadError && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {loadError}
        </div>
      )}

      {notes && notes.length === 0 && !loading && (
        <p className="section-label" style={{ color: 'var(--text-muted)' }}>
          No notes yet. Be the first to add one.
        </p>
      )}

      {notes && notes.length > 0 && (
        <ul className="workspace-list" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {notes.map((note) => (
            <AnnotationRow
              key={note.id}
              note={note}
              // Edit/delete only for the author or the workspace owner (Req 7.3–7.5).
              canEdit={note.authorId === currentReaderId || isOwner}
              workspaceId={workspaceId}
              token={token}
              onAuthError={onAuthError}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnotationRow({
  note,
  canEdit,
  workspaceId,
  token,
  onAuthError,
  onUpdated,
  onDeleted,
}: {
  note: Annotation;
  canEdit: boolean;
  workspaceId: string;
  token: string;
  onAuthError?: (error: unknown) => void;
  onUpdated: (updated: Annotation) => void;
  onDeleted: (annotationId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await editAnnotation(workspaceId, note.id, trimmed, token);
      onUpdated({ ...note, text: trimmed, updatedAt: new Date().toISOString() });
      setEditing(false);
    } catch (err) {
      onAuthError?.(err);
      setError(errMessage(err, 'Could not save the note. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAnnotation(workspaceId, note.id, token);
      onDeleted(note.id);
    } catch (err) {
      onAuthError?.(err);
      setError(errMessage(err, 'Could not delete the note. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <li className="mini-card" style={{ display: 'block' }}>
      {/* Attributed to the authoring reader AS A NOTE — never a verdict or rating (Req 10.6). */}
      <div className="section-label" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        <MessageSquare size={12} aria-hidden="true" style={{ color: ACCENT, verticalAlign: '-2px', marginRight: 4 }} />
        Note by {note.authorId} · {formatTime(note.createdAt)}
      </div>

      {editing ? (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          <label className="sr-only" htmlFor={`edit-note-${note.id}`}>
            Edit note
          </label>
          <textarea
            id={`edit-note-${note.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
            rows={2}
            disabled={busy}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn" disabled={busy || draft.trim().length === 0} aria-label="Save note">
              <Pencil size={14} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setDraft(note.text);
                setEditing(false);
                setError(null);
              }}
              aria-label="Cancel editing note"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note.text}</p>
      )}

      {canEdit && !editing && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 30, padding: '0 10px' }}
            onClick={() => setEditing(true)}
            disabled={busy}
            aria-label="Edit note"
          >
            <Pencil size={13} aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 30, padding: '0 10px' }}
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Delete note"
          >
            <Trash2 size={13} aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}
    </li>
  );
}
