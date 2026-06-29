// Feature: institutional-workspace — offline-first wiring test (task 10.3)
// Validates: Requirements 9.10
//
// Req 9.10: WHILE the server runs with the in-memory Repository and no API keys,
// THE Workspace, collection, annotation, and membership operations SHALL complete
// without error and SHALL return the resulting state.
//
// Same offline-forcing approach as reportGraph.offlineWiring.test.ts: config.ts
// snapshots process.env once at import time via ./env, letting *real* env vars win
// over the repo's .env file. So we pin the offline path (memory drivers, empty
// DATABASE_URL/REDIS_URL — empty still counts as "real env present" and beats the
// .env postgres URL, reproducing the absent condition) and mock providers BEFORE
// the first import of compose, then dynamically import buildContext. With zero API
// keys the composed repo is the InMemoryRepository — the offline path. We then run
// a representative end-to-end Workspace sequence through it and assert each
// operation completes without throwing and returns the resulting state.

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';

// --- force the offline path before config.ts snapshots process.env ---
const OFFLINE_ENV: Record<string, string> = {
  REPO_DRIVER: 'memory', // default/offline repository driver
  CACHE_DRIVER: 'memory',
  QUEUE_DRIVER: 'memory',
  DATABASE_URL: '', // no database -> offline repo selected
  REDIS_URL: '',
  LLM_PROVIDER: 'mock',
  EVIDENCE_PROVIDER: 'mock',
  PERSPECTIVE_PROVIDER: 'mock',
};

const saved: Record<string, string | undefined> = {};
for (const key of Object.keys(OFFLINE_ENV)) {
  saved[key] = process.env[key];
  process.env[key] = OFFLINE_ENV[key];
}

// Dynamic import so the env overrides above are in place when config.ts reads them.
const { buildContext } = await import('../src/compose');

// config.ts has now snapshotted the env; restore the real values for any sibling.
for (const key of Object.keys(OFFLINE_ENV)) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

test('offline wiring: every workspace/collection/annotation/membership op completes and returns state (Req 9.10)', async () => {
  const { repo } = buildContext();

  // With no DATABASE_URL and the default/memory driver, the offline path is chosen.
  assert.ok(
    repo instanceof InMemoryRepository,
    'expected the offline path (no DATABASE_URL) to compose an InMemoryRepository',
  );

  const owner = 'owner-subject';
  const invitee = 'invitee-subject';
  // The in-memory repo does not enforce the report FK, so any report id is fine.
  const reportA = 'report-a';
  const reportB = 'report-b';

  // --- Workspace + owner membership (createWorkspace) ---
  const ws = await repo.createWorkspace(owner, 'Newsroom');
  assert.equal(ws.role, 'owner', 'creator is seeded as owner');
  assert.ok(ws.id, 'workspace has an id');

  assert.equal(await repo.workspaceExists(ws.id), true, 'workspace now exists');
  assert.equal(await repo.getMembership(ws.id, owner), 'owner', 'owner membership readable');

  const ownerWorkspaces = await repo.listWorkspacesForReader(owner);
  assert.deepEqual(ownerWorkspaces, [{ id: ws.id, name: 'Newsroom', role: 'owner' }], 'owner lists the workspace');

  // --- Invite + redeem (membership) ---
  const code = await repo.createInvite(ws.id);
  assert.ok(code, 'invite code issued');

  const redeemed = await repo.redeemInvite(code, invitee);
  assert.deepEqual(redeemed, { workspaceId: ws.id, role: 'member' }, 'redeem creates a member membership');
  assert.equal(await repo.getMembership(ws.id, invitee), 'member', 'invitee membership readable');

  const membersAfterRedeem = await repo.listMembers(ws.id);
  assert.equal(membersAfterRedeem.length, 2, 'workspace has owner + invitee');
  assert.deepEqual(
    [...membersAfterRedeem].map((m) => `${m.readerId}:${m.role}`).sort(),
    ['invitee-subject:member', 'owner-subject:owner'],
    'members carry subject + role',
  );

  // --- Shared collection (createCollection / listCollections) ---
  const collection = await repo.createCollection(ws.id, 'Investigation');
  assert.ok(collection.id, 'collection has an id');
  assert.deepEqual(await repo.listCollections(ws.id), [{ id: collection.id, name: 'Investigation' }], 'collection listed');

  // --- Collection items (add / list / remove) ---
  await repo.addCollectionItem(collection.id, reportA);
  await repo.addCollectionItem(collection.id, reportB);
  const items = await repo.listCollectionItems(collection.id);
  assert.equal(items.length, 2, 'two items added and listed');
  assert.deepEqual(items.map((i) => i.reportId).sort(), [reportA, reportB].sort(), 'both reports present');

  await repo.removeCollectionItem(collection.id, reportA);
  const itemsAfterRemove = await repo.listCollectionItems(collection.id);
  assert.deepEqual(itemsAfterRemove.map((i) => i.reportId), [reportB], 'remove leaves the other item');

  // --- Annotations (create / list / edit / delete) ---
  const annotation = await repo.createAnnotation({
    workspaceId: ws.id,
    reportId: reportB,
    authorId: owner,
    text: 'Initial note.',
  });
  assert.ok(annotation.id, 'annotation has an id');

  const listed = await repo.listAnnotations(ws.id, reportB);
  assert.equal(listed.length, 1, 'annotation listed for the report');
  assert.equal(listed[0]!.text, 'Initial note.', 'annotation text returned');

  await repo.updateAnnotation(annotation.id, 'Edited note.');
  const edited = await repo.getAnnotation(annotation.id);
  assert.equal(edited?.text, 'Edited note.', 'edit updates the text');
  assert.ok(edited!.updatedAt >= edited!.createdAt, 'updatedAt advanced');

  await repo.deleteAnnotation(annotation.id);
  assert.equal(await repo.getAnnotation(annotation.id), undefined, 'annotation deleted');
  assert.deepEqual(await repo.listAnnotations(ws.id, reportB), [], 'no annotations remain');

  // --- Remove member (membership) ---
  await repo.removeMember(ws.id, invitee);
  assert.equal(await repo.getMembership(ws.id, invitee), undefined, 'membership removed');
  assert.deepEqual(
    (await repo.listMembers(ws.id)).map((m) => m.readerId),
    [owner],
    'only the owner remains',
  );

  // --- Delete collection (drops collection + its items) ---
  await repo.deleteCollection(ws.id, collection.id);
  assert.deepEqual(await repo.listCollections(ws.id), [], 'collection deleted');
  assert.deepEqual(await repo.listCollectionItems(collection.id), [], 'items dropped with the collection');
});
