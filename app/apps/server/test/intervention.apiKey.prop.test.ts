// Feature: intervention-and-scale, Property 12: API keys are URL-safe, high-entropy, unique, and hash-only persisted
// Feature: intervention-and-scale, Property 13: API-key authentication accepts only live issued keys
// Feature: intervention-and-scale, Property 14: Active-key limit holds at the boundary
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 8.7

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { apiKeyAuth } from '../src/http/auth';

const MIN_RUNS = 100;

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

// Drive the apiKeyAuth middleware with a minimal mock Request/Response/next.
// Captures whether next() ran, the HTTP status, and the resolved key context.
interface AuthOutcome {
  nextCalled: boolean;
  statusCode: number | undefined;
  apiKey: Request['apiKey'];
}

async function runAuth(mw: RequestHandler, authHeader: string | undefined): Promise<AuthOutcome> {
  const req = {
    headers: authHeader === undefined ? {} : { authorization: authHeader },
  } as unknown as Request;

  let statusCode: number | undefined;
  let nextCalled = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(_body: unknown) {
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    nextCalled = true;
  };

  await (mw(req, res, next) as unknown as Promise<void>);
  return { nextCalled, statusCode, apiKey: req.apiKey };
}

// Property 12 ---

describe('Property 12: API keys are URL-safe, high-entropy, unique, and hash-only persisted', () => {
  it('issued plaintext is base64url, >=32 bytes, unique, and only its sha256 hash is queryable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (n) => {
        const repo = new InMemoryRepository();
        const issued: { keyId: string; plaintext: string; institutionId: string }[] = [];

        // Distinct institution per key so the per-institution active-key cap (10)
        // never interferes with raw generation properties.
        for (let i = 0; i < n; i++) {
          const institutionId = `inst-${i}`;
          const { keyId, plaintext } = await repo.createApiKey(institutionId);
          issued.push({ keyId, plaintext, institutionId });
        }

        for (const k of issued) {
          // URL-safe base64url alphabet only — no '+', '/', or '=' padding.
          assert.match(k.plaintext, /^[A-Za-z0-9_-]+$/, `not url-safe: ${k.plaintext}`);
          // Decodes to at least 32 bytes of entropy (Req 6.1).
          assert.ok(
            Buffer.from(k.plaintext, 'base64url').length >= 32,
            `decoded entropy < 32 bytes for ${k.plaintext}`,
          );
        }

        // All issued plaintexts and key ids are distinct within the run (Req 6.1).
        assert.equal(new Set(issued.map((k) => k.plaintext)).size, issued.length);
        assert.equal(new Set(issued.map((k) => k.keyId)).size, issued.length);

        for (const k of issued) {
          // findApiKeyByHash(sha256(plaintext)) resolves the bound key (Req 6.2).
          const found = await repo.findApiKeyByHash(sha256hex(k.plaintext));
          assert.ok(found, 'hash of plaintext should resolve a key');
          assert.equal(found.keyId, k.keyId);
          assert.equal(found.institutionId, k.institutionId);

          // The plaintext itself is NOT a stored lookup key — only its hash is
          // persisted (Req 6.8). Querying by the raw plaintext finds nothing.
          assert.equal(await repo.findApiKeyByHash(k.plaintext), undefined);
        }

        // A wrong hash never resolves (Req 6.3).
        assert.equal(await repo.findApiKeyByHash(sha256hex(`absent-${Math.random()}`)), undefined);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});

// Property 13 ---

describe('Property 13: API-key authentication accepts only live issued keys', () => {
  it('accepts live keys (next + apiKey), rejects missing/malformed/revoked/unknown with 401', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        async (revokeFlags) => {
          const repo = new InMemoryRepository();
          const mw = apiKeyAuth(repo);

          const live: { keyId: string; plaintext: string; institutionId: string }[] = [];
          const revoked: { plaintext: string }[] = [];

          // Distinct institution per key so the active-key cap never trips here.
          for (let i = 0; i < revokeFlags.length; i++) {
            const institutionId = `inst-${i}`;
            const { keyId, plaintext } = await repo.createApiKey(institutionId);
            if (revokeFlags[i]) {
              await repo.revokeApiKey(keyId);
              revoked.push({ plaintext });
            } else {
              live.push({ keyId, plaintext, institutionId });
            }
          }

          // Live keys: next() runs, no status set, resolved context attached (Req 6.2, 6.6).
          for (const k of live) {
            const r = await runAuth(mw, `Bearer ${k.plaintext}`);
            assert.ok(r.nextCalled, 'live key should call next()');
            assert.equal(r.statusCode, undefined);
            assert.ok(r.apiKey, 'live key should attach apiKey context');
            assert.equal(r.apiKey?.keyId, k.keyId);
            assert.equal(r.apiKey?.institutionId, k.institutionId);
          }

          // Revoked keys: 401, no next, no context (Req 6.3, 6.4, 8.7).
          for (const k of revoked) {
            const r = await runAuth(mw, `Bearer ${k.plaintext}`);
            assert.equal(r.nextCalled, false);
            assert.equal(r.statusCode, 401);
            assert.equal(r.apiKey, undefined);
          }

          // Missing header → 401, no next (Req 6.3).
          const missing = await runAuth(mw, undefined);
          assert.equal(missing.nextCalled, false);
          assert.equal(missing.statusCode, 401);

          // Malformed/empty bearer → 401, no next (Req 6.3).
          const empty = await runAuth(mw, 'Bearer    ');
          assert.equal(empty.nextCalled, false);
          assert.equal(empty.statusCode, 401);

          // Unknown (never-issued) key → 401, no next (Req 6.3).
          const unknown = await runAuth(mw, `Bearer unknown-${Math.random()}-key`);
          assert.equal(unknown.nextCalled, false);
          assert.equal(unknown.statusCode, 401);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});

// Property 14 ---

describe('Property 14: Active-key limit holds at the boundary', () => {
  it('creation succeeds up to 10, the 11th throws, and revoking frees a slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 0, max: 9 }),
        async (institutionId, revokeIdx) => {
          const repo = new InMemoryRepository();
          const keyIds: string[] = [];

          // Up to 10 active keys for one institution all succeed (Req 6.7).
          for (let i = 0; i < 10; i++) {
            const { keyId } = await repo.createApiKey(institutionId);
            keyIds.push(keyId);
          }
          assert.equal(await repo.countActiveApiKeys(institutionId), 10);

          // The 11th active key is refused at the boundary (Req 6.7).
          await assert.rejects(() => repo.createApiKey(institutionId), /ActiveKeyLimit/);
          assert.equal(await repo.countActiveApiKeys(institutionId), 10);

          // A different institution is unaffected by this one's cap (Req 6.6).
          const other = await repo.createApiKey(`other-${institutionId}`);
          assert.ok(other.keyId);

          // Revoking frees exactly one slot (Req 6.4, 6.7).
          await repo.revokeApiKey(keyIds[revokeIdx]!);
          assert.equal(await repo.countActiveApiKeys(institutionId), 9);

          // The freed slot allows one more creation, then the cap holds again.
          const replacement = await repo.createApiKey(institutionId);
          assert.ok(replacement.keyId);
          assert.equal(await repo.countActiveApiKeys(institutionId), 10);
          await assert.rejects(() => repo.createApiKey(institutionId), /ActiveKeyLimit/);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
