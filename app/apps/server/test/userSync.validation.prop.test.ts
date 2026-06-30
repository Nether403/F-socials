// Feature: supabase-user-sync, Property 7: Malformed identity or claims rejected with no side effect
// Validates: Requirements 3.4, 8.2, 8.3, 8.4, 8.5
//
// For any flag request whose verified subject is absent or not a UUID-formatted
// string, or whose present email/role violates the trust-boundary bounds (email a
// valid address <=320 chars; role non-empty <=255 chars), the route responds 400
// invalid_identity and persists neither a Local_User nor a flag.
//
// Harness mirrors flag.persist.test.ts: a tiny middleware sets req.user before the
// router so requireAuth passes (req.user is always a truthy object), letting the
// request reach the syncedIdentitySchema trust boundary inside the flag route. The
// flag payload is otherwise valid — it names a technique the seeded report actually
// surfaced — so the ONLY reason for rejection is the malformed identity/claims.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport, FramingSignal } from '../src/types';

const TECHNIQUES = ['Emotional Language', 'Us vs Them', 'Fearmongering', 'Loaded Language'];
const REPORT_ID = 'report-validation';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// A syntactically valid value for the field that is NOT the injected violation,
// so each generated identity is invalid in exactly one targeted way.
const VALID_EMAIL = 'reader@example.test';
const VALID_ROLE = 'authenticated';

function signal(technique: string): FramingSignal {
  return {
    technique,
    severity: 'medium',
    description: `Use of ${technique}.`,
    examples: [{ text: 'sample quote', explanation: 'why it is this technique', startIndex: 0, endIndex: 12 }],
  };
}

function seededReport(): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: REPORT_ID,
    contentId: 'content-validation',
    urlHash: 'hash-validation',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: TECHNIQUES.map(signal),
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

// A malformed identity: invalid in at least one of subject / email / role.
type Identity = { id?: unknown; email?: unknown; role?: unknown };

// Subject absent / empty / non-UUID (Req 8.2, 8.3).
const invalidId = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.string().filter((s) => !UUID_RE.test(s)),
);

// Present email that is either format-invalid or longer than 320 chars (Req 8.4, 8.5).
const invalidEmail = fc.oneof(
  fc.constantFrom('notanemail', 'a@', '@b.com', 'a b@c.com', 'foo@', 'no-at-sign'),
  fc.constant('x'.repeat(312) + '@example.com'), // 324 chars > 320
);

// Present role that is either empty or longer than 255 chars (Req 8.4, 8.5).
const invalidRole = fc.oneof(fc.constant(''), fc.string({ minLength: 256, maxLength: 400 }));

const identityArb: fc.Arbitrary<Identity> = fc.oneof(
  // Subject violation; email/role kept valid-or-absent so the subject is the fault.
  fc.record({
    id: invalidId,
    email: fc.constantFrom(undefined, VALID_EMAIL),
    role: fc.constantFrom(undefined, VALID_ROLE),
  }),
  // Email violation; subject is a valid UUID so sync would otherwise run.
  fc.record({
    id: fc.uuid(),
    email: invalidEmail,
    role: fc.constantFrom(undefined, VALID_ROLE),
  }),
  // Role violation; subject is a valid UUID so sync would otherwise run.
  fc.record({
    id: fc.uuid(),
    email: fc.constantFrom(undefined, VALID_EMAIL),
    role: invalidRole,
  }),
);

test('Property 7: malformed identity/claims rejected (400 invalid_identity), no user and no flag persisted', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());

  // The current identity under test; the stub reads it so requireAuth always sees
  // a truthy req.user and the request reaches the route's trust boundary.
  let currentUser: Identity = {};
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = currentUser as Request['user'];
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authStub,
    makeRouter({
      repo,
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1000),
      telemetry: noopTelemetry,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/v1/analyses/${REPORT_ID}/flags`;

  try {
    await fc.assert(
      fc.asyncProperty(identityArb, fc.constantFrom(...TECHNIQUES), async (identity, technique) => {
        currentUser = identity;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ technique }), // otherwise-valid payload
        });

        // Client error with the identity-validation indicator (Req 8.3, 8.5).
        assert.equal(res.status, 400);
        const json = (await res.json()) as { error?: string };
        assert.equal(json.error, 'invalid_identity');

        // No flag persisted, ever — strongest invariant, never reset (Req 3.4, 8.3, 8.5).
        assert.equal(repo.flags.length, 0);

        // No Local_User created: sync was never invoked (Req 8.3, 8.5).
        if (typeof identity.id === 'string' && identity.id.length > 0) {
          assert.equal(await repo.getLocalUser(identity.id), undefined);
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
