// Feature: institutional-workspace, Property 13: Token attachment follows session state
// Validates: Requirements 13.2, 13.3
//
// Every institutional-workspace call (createWorkspace, listWorkspaces, createInvite,
// redeemInvite, listMembers, removeMember, createCollection, listCollections,
// deleteCollection, addCollectionItem, listCollectionItems, removeCollectionItem,
// createAnnotation, listAnnotations, editAnnotation, deleteAnnotation) routes through
// authedFetch(path, init, token). The universal guarantee these calls inherit:
//   an `Authorization: Bearer <token>` header is attached to the outgoing request
//   IF AND ONLY IF a non-empty session token is supplied; with no active session
//   (no/empty token) the request carries no `Authorization` header at all (Req 13.2,
//   13.3 — while a Session is active the header is attached on every workspace,
//   collection, collection-item, membership, invitation, or annotation request).
//
// We stub the global `fetch`, drive an arbitrary workspace call with an arbitrary
// token (absent / empty / non-empty), then inspect the actual Headers object handed
// to fetch. The iff is asserted against an independent oracle (attach exactly when a
// non-empty token string is present) so the test does not echo the implementation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  createWorkspace,
  listWorkspaces,
  createInvite,
  redeemInvite,
  listMembers,
  removeMember,
  createCollection,
  listCollections,
  deleteCollection,
  addCollectionItem,
  listCollectionItems,
  removeCollectionItem,
  createAnnotation,
  listAnnotations,
  editAnnotation,
  deleteAnnotation,
} from './client';

// Capture the Headers passed to fetch. The stub returns a 200 with a JSON body so
// json-returning calls resolve normally and workspaceFetch never throws (a 401 →
// AuthExpiredError, a 403 → WorkspaceForbiddenError are different contracts, out of
// scope here). `{}` is valid for `.json()` and harmless for void callers.
let lastHeaders: Headers | undefined;
function stubFetch() {
  lastHeaders = undefined;
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    lastHeaders = new Headers(init?.headers);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Generators --------------------------------------------------------------
// The session token field: absent (no session), empty string (falsy — not a real
// token), or a non-empty token string. The contract attaches the header exactly
// when a non-empty token is supplied. Real Access_Tokens are JWTs carrying no
// whitespace; we exclude whitespace because the Headers API legitimately trims
// leading/trailing whitespace from header values (normalization, not session state).
const tokenArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !/\s/.test(s)),
);

// Each entry invokes one workspace call with placeholder identifiers and the given
// token. The client signatures type `token` as a required string; we cast so the
// generator can also drive the no-session (undefined/empty) cases at runtime. Every
// call covers a distinct route group: workspace, invitation, membership, collection,
// collection-item, and annotation (Req 13.2 enumerates exactly these route groups).
type Call = (token: string | undefined) => Promise<unknown>;
const t = (token: string | undefined) => token as unknown as string;
const calls: { name: string; invoke: Call }[] = [
  { name: 'createWorkspace', invoke: (k) => createWorkspace('Team Workspace', t(k)) },
  { name: 'listWorkspaces', invoke: (k) => listWorkspaces(t(k)) },
  { name: 'createInvite', invoke: (k) => createInvite('ws-1', t(k)) },
  { name: 'redeemInvite', invoke: (k) => redeemInvite('code-1', t(k)) },
  { name: 'listMembers', invoke: (k) => listMembers('ws-1', t(k)) },
  { name: 'removeMember', invoke: (k) => removeMember('ws-1', 'reader-2', t(k)) },
  { name: 'createCollection', invoke: (k) => createCollection('ws-1', 'Reading list', t(k)) },
  { name: 'listCollections', invoke: (k) => listCollections('ws-1', t(k)) },
  { name: 'deleteCollection', invoke: (k) => deleteCollection('ws-1', 'col-1', t(k)) },
  { name: 'addCollectionItem', invoke: (k) => addCollectionItem('ws-1', 'col-1', 'rep-1', t(k)) },
  { name: 'listCollectionItems', invoke: (k) => listCollectionItems('ws-1', 'col-1', t(k)) },
  { name: 'removeCollectionItem', invoke: (k) => removeCollectionItem('ws-1', 'col-1', 'rep-1', t(k)) },
  { name: 'createAnnotation', invoke: (k) => createAnnotation('ws-1', 'rep-1', 'A note', t(k)) },
  { name: 'listAnnotations', invoke: (k) => listAnnotations('ws-1', 'rep-1', t(k)) },
  { name: 'editAnnotation', invoke: (k) => editAnnotation('ws-1', 'ann-1', 'Edited note', t(k)) },
  { name: 'deleteAnnotation', invoke: (k) => deleteAnnotation('ws-1', 'ann-1', t(k)) },
];

const callArb = fc.constantFrom(...calls);

// Independent oracle for Property 13: a Bearer header is attached iff a non-empty
// token string was supplied.
const shouldAttach = (token: string | undefined): token is string =>
  typeof token === 'string' && token.length > 0;

describe('workspace API (Property 13: token attachment follows session state)', () => {
  it('attaches Authorization: Bearer iff a session token is supplied, across every workspace call', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, tokenArb, async (call, token) => {
        stubFetch();
        await call.invoke(token);

        const auth = lastHeaders!.get('Authorization');
        if (shouldAttach(token)) {
          // iff (forward): an active session attaches exactly one Bearer header
          // carrying the access token (Req 13.2, 13.3).
          expect(auth).toBe(`Bearer ${token}`);
        } else {
          // iff (reverse): no session ⇒ no Authorization header at all.
          expect(auth).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
