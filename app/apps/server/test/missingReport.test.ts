// Feature: trust-and-launch-bundle, Property 8: Disputes and flags targeting a
// nonexistent report are not-found and never persisted.
//
// For any report id that does not exist in the repo, BOTH the public dispute
// route and the authed flag route load repo.getReport(id), find nothing, and
// 404 before writing — so repo.disputes and repo.flags stay empty. (Req 3.6)

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { withTestApp } from './helpers/makeTestApp';

async function postJson(base: string, path: string, body: unknown): Promise<number> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

test('disputes and flags on a nonexistent report 404 and persist nothing', async () => {
  // Fixed-user auth so the flag route exercises its 404 (not the 401).
  await withTestApp({ auth: { user: { id: 'user-1', role: 'authenticated' } } }, async (app) => {
    const repo = app.repo;
    const base = app.base;

    await fc.assert(
      fc.asyncProperty(
        // Random ids that are never seeded into the repo.
        fc.oneof(fc.uuid(), fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('/'))),
        fc.string({ minLength: 1, maxLength: 2000 }), // valid dispute reason
        fc.string({ minLength: 1, maxLength: 200 }),   // valid flag technique
        async (id, reason, technique) => {
          const encoded = encodeURIComponent(id);
          const disputeStatus = await postJson(base, `/api/v1/analyses/${encoded}/disputes`, { reason });
          const flagStatus = await postJson(base, `/api/v1/analyses/${encoded}/flags`, { technique });

          assert.equal(disputeStatus, 404, `dispute on missing report should 404, got ${disputeStatus}`);
          assert.equal(flagStatus, 404, `flag on missing report should 404, got ${flagStatus}`);
          // Nothing was persisted on either route.
          assert.equal(repo.disputes.length, 0, 'no dispute should be persisted');
          assert.equal(repo.flags.length, 0, 'no flag should be persisted');
        },
      ),
      { numRuns: 100 },
    );
  });
});
