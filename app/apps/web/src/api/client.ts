import type {
  AnalysisReport,
  Annotation,
  CollectionItemEntry,
  Membership,
  PolicyDescriptor,
  ReportStatus,
  ResolutionOutcome,
  ReviewItem,
  ReviewLifecycle,
  SavedReportEntry,
  SharedCollection,
  SourceType,
  WorkspaceSummary,
} from './types';

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

// Thrown by authedFetch when a request comes back 401, so callers can tear down
// the session and fall back to the Anonymous experience (Req 4.4). A named class
// (rather than a plain Error) lets useSession distinguish expiry from a generic
// failure with `instanceof`.
export class AuthExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

// Thrown by a workspace call when the server responds 403, so the Workspace_View
// can show an access-denied message and not present the requested workspace's data
// (Req 13.6). A named class lets callers distinguish a membership/role denial from a
// generic failure with `instanceof`, mirroring AuthExpiredError.
export class WorkspaceForbiddenError extends Error {
  constructor(message = 'You do not have access to this workspace.') {
    super(message);
    this.name = 'WorkspaceForbiddenError';
  }
}

// Fetch wrapper for identity/mutating routes. Attaches `Authorization: Bearer
// <accessToken>` if and only if a token is present, and omits the header
// entirely otherwise (Req 3.4, 4.2, 4.3). A 401 is mapped to AuthExpiredError so
// callers can clear the session (Req 4.4); every other status is returned as-is
// for the caller to interpret.
export async function authedFetch(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401) throw new AuthExpiredError();
  return res;
}

export interface SubmitInput {
  sourceType: SourceType;
  url?: string;
  transcript?: string;
}

// Decide what kind of input the user pasted.
export function detectInput(raw: string): SubmitInput {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) {
    if (/youtube\.com|youtu\.be/i.test(t)) return { sourceType: 'youtube', url: t };
    return { sourceType: 'article', url: t };
  }
  return { sourceType: 'transcript', transcript: t };
}

export interface SubmitResult {
  reportId: string;
  status: ReportStatus;
  cached: boolean;
}

export async function submitAnalysis(input: SubmitInput): Promise<SubmitResult> {
  const res = await fetch(`${API}/api/v1/analyses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? 'Rate limit reached. Try again later.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

// Submit an anonymous dispute against a report (3.8). Server returns 201 { ok: true };
// 404 if the report is gone, 400 on an invalid reason. Throws on any non-ok so the
// modal can keep itself open and surface the message (3.9).
export async function submitDispute(
  reportId: string,
  body: { reason: string; claimId?: string },
): Promise<void> {
  const res = await fetch(`${API}/api/v1/analyses/${reportId}/disputes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not submit dispute (${res.status})`);
  }
}

// Submit an authenticated flag for a framing technique (3.3, 3.5). The endpoint is
// behind requireAuth, so this is only reachable once the user is signed in; the web
// app gates the call and shows an auth prompt for anonymous users (3.11). The token
// is attached via authedFetch when present (Req 6.3); a 401 surfaces as
// AuthExpiredError, any other non-ok throws with the server message.
export async function submitFlag(
  reportId: string,
  body: { technique: string; note?: string },
  token?: string,
): Promise<void> {
  const res = await authedFetch(
    `/api/v1/analyses/${reportId}/flags`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not submit flag (${res.status})`);
  }
}

// --- Saved reports / history (Req 7, 8, 9) ----------------------------------
// All three are behind requireAuth on the server; the token is attached via
// authedFetch (Req 6.4, 7.1). A 401 surfaces as AuthExpiredError so the caller
// can clear the session; any other non-ok throws the server message so the web
// layer can show "save did not complete" / a history error and re-enable retry.

// POST /analyses/:id/save — idempotent server-side (Req 7).
export async function saveReport(reportId: string, token: string): Promise<void> {
  const res = await authedFetch(`/api/v1/analyses/${reportId}/save`, { method: 'POST' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not save report (${res.status})`);
  }
}

// DELETE /analyses/:id/save — idempotent; removing an unsaved report is success (Req 8).
export async function unsaveReport(reportId: string, token: string): Promise<void> {
  const res = await authedFetch(`/api/v1/analyses/${reportId}/save`, { method: 'DELETE' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not remove saved report (${res.status})`);
  }
}

// GET /saved-reports — reader-scoped, newest-first; [] when none (Req 9).
export async function listSavedReports(token: string): Promise<SavedReportEntry[]> {
  const res = await authedFetch('/api/v1/saved-reports', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not load saved reports (${res.status})`);
  }
  return res.json();
}

// --- Expert review queue (11.1, 11.8) ---------------------------------------
// All four are behind requireAuth + reviewerGuard on the server; the console gates
// the calls and resolves 401/403 to the sign-in/error state. They mirror the
// submitDispute/submitFlag fetch+throw style: throw on any non-ok so the console can
// surface the message and leave the item unchanged for retry (11.9). The item
// mutations unwrap the server's { item } envelope to the updated ReviewItem (11.8).

// GET /review/queue with optional ?status= filter; returns the queue (200, [] when
// empty). Throws on non-ok (e.g. 400 invalid filter, 401/403 unauthorized).
export async function getReviewQueue(status?: ReviewLifecycle): Promise<ReviewItem[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${API}/api/v1/review/queue${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not load review queue (${res.status})`);
  }
  return res.json();
}

// POST /review/items/:id/claim; returns the updated item. The id is "{kind}:{sourceId}"
// and is URL-encoded into the path. Throws on non-ok (404 not found, 409 conflict).
export async function claimReviewItem(id: string): Promise<ReviewItem> {
  const res = await fetch(`${API}/api/v1/review/items/${encodeURIComponent(id)}/claim`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not claim review item (${res.status})`);
  }
  const body = await res.json();
  return body.item;
}

// POST /review/items/:id/release; returns the updated item. Throws on non-ok
// (404 not found, 409 not actionable / conflict).
export async function releaseReviewItem(id: string): Promise<ReviewItem> {
  const res = await fetch(`${API}/api/v1/review/items/${encodeURIComponent(id)}/release`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not release review item (${res.status})`);
  }
  const body = await res.json();
  return body.item;
}

// POST /review/items/:id/resolution with a JSON body; returns the updated item.
// Throws on non-ok (400 invalid outcome/note, 404 not found).
export async function resolveReviewItem(
  id: string,
  body: { outcome: ResolutionOutcome; note?: string },
): Promise<ReviewItem> {
  const res = await fetch(`${API}/api/v1/review/items/${encodeURIComponent(id)}/resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not submit resolution (${res.status})`);
  }
  const resBody = await res.json();
  return resBody.item;
}

export async function getReport(id: string): Promise<AnalysisReport> {
  const res = await fetch(`${API}/api/v1/analyses/${id}`);
  if (!res.ok) throw new Error(`Could not load report (${res.status})`);
  return res.json();
}

export async function getReportBySlug(slug: string): Promise<AnalysisReport> {
  const res = await fetch(`${API}/api/v1/r/${slug}`);
  if (res.status === 404) throw new Error('This shared report could not be found.');
  if (!res.ok) throw new Error(`Could not load shared report (${res.status})`);
  return res.json();
}

export async function getPolicy(): Promise<PolicyDescriptor> {
  const res = await fetch(`${API}/api/v1/policy`);
  if (!res.ok) throw new Error(`Could not load policy (${res.status})`);
  return res.json();
}

const TERMINAL: ReportStatus[] = ['ready', 'failed', 'needs_review'];

// Poll until the report reaches a terminal status (or timeout).
export async function pollReport(
  id: string,
  onTick?: (status: ReportStatus) => void,
  opts: { intervalMs?: number; maxTries?: number } = {},
): Promise<AnalysisReport> {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxTries = opts.maxTries ?? 40;
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const report = await getReport(id);
    onTick?.(report.status);
    if (TERMINAL.includes(report.status)) return report;
  }
  throw new Error('Analysis timed out. Please try again.');
}

// --- Institutional workspace (Req 13.2, 13.3, 13.5, 13.6) -------------------
// Every call routes through authedFetch so `Authorization: Bearer` is attached iff
// a session token is supplied and a 401 surfaces as AuthExpiredError for the
// existing session teardown (Req 13.2, 13.3, 13.5). A 403 surfaces as the typed
// WorkspaceForbiddenError the views render as an access message (Req 13.6); any
// other non-ok throws the server message so the caller can retry. The reader is
// never sent in the path — identity comes from the verified token.

// Shared helper: authedFetch + the workspace 403/non-ok contract. Returns the raw
// Response so JSON-returning callers can parse and void callers can ignore it.
async function workspaceFetch(
  path: string,
  init: RequestInit,
  token: string | undefined,
  action: string,
): Promise<Response> {
  const res = await authedFetch(path, init, token);
  if (res.status === 403) throw new WorkspaceForbiddenError();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Could not ${action} (${res.status})`);
  }
  return res;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// POST /workspaces — creates a workspace; the reader becomes its owner (Req 1.1, 1.2).
export async function createWorkspace(name: string, token: string): Promise<WorkspaceSummary> {
  const res = await workspaceFetch('/api/v1/workspaces', jsonInit('POST', { name }), token, 'create workspace');
  return res.json();
}

// GET /workspaces — the reader's workspaces, [] when none (Req 4.1, 4.3).
export async function listWorkspaces(token: string): Promise<WorkspaceSummary[]> {
  const res = await workspaceFetch('/api/v1/workspaces', {}, token, 'load workspaces');
  return res.json();
}

// POST /workspaces/:id/invites — owner-only; returns the redeemable code (Req 2.1).
export async function createInvite(workspaceId: string, token: string): Promise<string> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invites`,
    { method: 'POST' },
    token,
    'create invite',
  );
  const body = await res.json();
  return body.code;
}

// POST /invites/:code/redeem — joins the bound workspace as a member (Req 2.3).
export async function redeemInvite(
  code: string,
  token: string,
): Promise<{ workspaceId: string; role: WorkspaceSummary['role'] }> {
  const res = await workspaceFetch(
    `/api/v1/invites/${encodeURIComponent(code)}/redeem`,
    { method: 'POST' },
    token,
    'redeem invite',
  );
  return res.json();
}

// GET /workspaces/:id/members — members of one workspace only (Req 3.1).
export async function listMembers(workspaceId: string, token: string): Promise<Membership[]> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {},
    token,
    'load members',
  );
  return res.json();
}

// DELETE /workspaces/:id/members/:readerId — owner-only (Req 3.2).
export async function removeMember(workspaceId: string, readerId: string, token: string): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(readerId)}`,
    { method: 'DELETE' },
    token,
    'remove member',
  );
}

// POST /workspaces/:id/collections — creates a shared collection (Req 5.1).
export async function createCollection(
  workspaceId: string,
  name: string,
  token: string,
): Promise<SharedCollection> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections`,
    jsonInit('POST', { name }),
    token,
    'create collection',
  );
  return res.json();
}

// GET /workspaces/:id/collections — collections of one workspace only (Req 5.2).
export async function listCollections(workspaceId: string, token: string): Promise<SharedCollection[]> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections`,
    {},
    token,
    'load collections',
  );
  return res.json();
}

// DELETE /workspaces/:id/collections/:cid — owner-only; cascades items (Req 5.5).
export async function deleteCollection(workspaceId: string, collectionId: string, token: string): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' },
    token,
    'delete collection',
  );
}

// POST /workspaces/:id/collections/:cid/items — idempotent add (Req 6.1, 6.2).
export async function addCollectionItem(
  workspaceId: string,
  collectionId: string,
  reportId: string,
  token: string,
): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections/${encodeURIComponent(collectionId)}/items`,
    jsonInit('POST', { reportId }),
    token,
    'add report to collection',
  );
}

// GET /workspaces/:id/collections/:cid/items — newest-first, deterministic (Req 6.4).
export async function listCollectionItems(
  workspaceId: string,
  collectionId: string,
  token: string,
): Promise<CollectionItemEntry[]> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections/${encodeURIComponent(collectionId)}/items`,
    {},
    token,
    'load collection items',
  );
  return res.json();
}

// DELETE /workspaces/:id/collections/:cid/items/:reportId — idempotent remove (Req 6.5, 6.6).
export async function removeCollectionItem(
  workspaceId: string,
  collectionId: string,
  reportId: string,
  token: string,
): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(reportId)}`,
    { method: 'DELETE' },
    token,
    'remove report from collection',
  );
}

// POST /workspaces/:id/reports/:reportId/annotations — author-attributed note (Req 7.1).
export async function createAnnotation(
  workspaceId: string,
  reportId: string,
  text: string,
  token: string,
): Promise<Annotation> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(reportId)}/annotations`,
    jsonInit('POST', { text }),
    token,
    'create annotation',
  );
  return res.json();
}

// GET /workspaces/:id/reports/:reportId/annotations — newest-first, scoped (Req 7.2).
export async function listAnnotations(
  workspaceId: string,
  reportId: string,
  token: string,
): Promise<Annotation[]> {
  const res = await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(reportId)}/annotations`,
    {},
    token,
    'load annotations',
  );
  return res.json();
}

// PATCH /workspaces/:id/annotations/:aid — author-or-owner; updates text (Req 7.3).
export async function editAnnotation(
  workspaceId: string,
  annotationId: string,
  text: string,
  token: string,
): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/annotations/${encodeURIComponent(annotationId)}`,
    jsonInit('PATCH', { text }),
    token,
    'edit annotation',
  );
}

// DELETE /workspaces/:id/annotations/:aid — author-or-owner (Req 7.5).
export async function deleteAnnotation(workspaceId: string, annotationId: string, token: string): Promise<void> {
  await workspaceFetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: 'DELETE' },
    token,
    'delete annotation',
  );
}
