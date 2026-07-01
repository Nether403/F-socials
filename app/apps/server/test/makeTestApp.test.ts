// Feature: test-harness — self-check for the makeTestApp() bootstrap helper.
// The helper is non-trivial wiring (auth seam selection + real router mount +
// ephemeral server), so it earns one runnable check: prove each auth seam routes
// correctly against the real /me (protected) and /policy (public) endpoints.
//
// Validates: the helper assembles the real router behind each AuthOption.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, withTestApp } from './helpers/makeTestApp';

test('auth: { user } sets req.user — GET /me returns that user (200)', async () => {
  await withTestApp({ auth: { user: { id: 'reader-x', role: 'authenticated' } } }, async (app) => {
    const res = await fetch(`${app.apiBase}/me`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { id: string } };
    assert.equal(body.user.id, 'reader-x');
  });
});

test("auth: 'real' with no token rejects a protected route with 401 auth_required", async () => {
  await withTestApp({ auth: 'real' }, async (app) => {
    const res = await fetch(`${app.apiBase}/me`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
  });
});

test("auth: 'header' sets req.user from x-test-user — GET /me returns it (200)", async () => {
  await withTestApp({ auth: 'header' }, async (app) => {
    const res = await fetch(`${app.apiBase}/me`, { headers: { 'x-test-user': 'reader-h' } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { id: string } };
    assert.equal(body.user.id, 'reader-h');
  });
});

test("auth: 'unconfigured' rejects a Bearer token with 401 auth_not_configured", async () => {
  await withTestApp({ auth: 'unconfigured' }, async (app) => {
    const res = await fetch(`${app.apiBase}/me`, { headers: { authorization: 'Bearer x.y.z' } });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_not_configured');
  });
});

test('public route /policy is reachable without auth (200) via the helper', async () => {
  const app = await makeTestApp({ auth: 'real' });
  try {
    const res = await fetch(`${app.apiBase}/policy`);
    assert.equal(res.status, 200);
  } finally {
    await app.close();
  }
});
