// Feature: supabase-user-sync, static architectural guards (smoke).
// Validates: Requirements 7.5, 8.1, 10.2
//
// A dependency-free static/smoke test (node:test, no fast-check) proving that
// User_Sync stays inside the project's persistence conventions and the compass:
//
//   7.1  Both Repository drivers implement ensureLocalUser / getLocalUser
//        (type-level via `implements Repository` + a runtime presence assertion).
//   8.1  The Postgres User_Sync upsert uses bound parameters only ($1/$2/$3) and
//        never builds SQL by string interpolation (no `${…}`, no `' + value`).
//   7.5  The only User_Sync SQL lives in postgres.ts — no `INSERT INTO users`
//        upsert exists anywhere else in src, and the in-memory driver carries no
//        SQL at all (its User_Sync path is a Map, not a query).
//   10.2 The LocalUser shape exposes only id / email / role / createdAt — no
//        content-truthfulness-verdict and no creator-reliability-rating field,
//        asserted both on the actual round-tripped runtime shape and statically
//        on the interface declaration.
//
// Mirrors the established convention in savedReports.guardsStatic.test.ts /
// workspace.guardsStatic.test.ts: resolve paths from import.meta.url, read the
// real source text, slice the load-bearing section, and assert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryRepository } from '../src/infra/memory';
import { PostgresRepository } from '../src/infra/postgres';
import type { Repository } from '../src/infra/ports';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(serverDir, 'src');
const portsPath = join(srcDir, 'infra', 'ports.ts');
const memoryPath = join(srcDir, 'infra', 'memory.ts');
const postgresPath = join(srcDir, 'infra', 'postgres.ts');

// Recursively collect every .ts file under src for the no-ad-hoc-query scan.
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Slice the User_Sync method block out of postgres.ts: from its section banner
// to the start of the method that immediately follows (saveAuditRecord). Slicing
// to EOF would scan unrelated later methods whose legitimate `${idx}` and
// `%${keyword}%` expressions would trip the negative checks below.
function postgresUserSyncSection(): string {
  const src = readFileSync(postgresPath, 'utf8');
  const start = src.indexOf('User_Sync (supabase-user-sync)');
  const end = src.indexOf('async saveAuditRecord', start);
  assert.ok(start !== -1, 'postgres.ts should contain the User_Sync section banner');
  assert.ok(end !== -1 && end > start, 'a method should follow the User_Sync section');
  return src.slice(start, end);
}

// Req 7.1 — both drivers implement ensureLocalUser / getLocalUser. The type-level
// guarantee comes from each class declaring `implements Repository` (this file
// would fail to compile otherwise); these runtime assertions catch an accidental
// rename or removal that the structural type check alone could miss.
test('Req 7.1: both Repository drivers implement ensureLocalUser / getLocalUser', () => {
  const mem = new InMemoryRepository();
  assert.equal(typeof mem.ensureLocalUser, 'function', 'InMemoryRepository.ensureLocalUser should exist');
  assert.equal(typeof mem.getLocalUser, 'function', 'InMemoryRepository.getLocalUser should exist');

  // PostgresRepository needs a live Pool to instantiate, so assert against its
  // prototype — the methods are class members regardless of construction.
  assert.equal(
    typeof PostgresRepository.prototype.ensureLocalUser,
    'function',
    'PostgresRepository.ensureLocalUser should exist',
  );
  assert.equal(
    typeof PostgresRepository.prototype.getLocalUser,
    'function',
    'PostgresRepository.getLocalUser should exist',
  );

  // Type-level cross-check: both drivers are assignable to the Repository seam,
  // which declares these methods (compile-time guarantee made explicit).
  const asRepo: Repository = mem;
  assert.equal(typeof asRepo.ensureLocalUser, 'function');
});

// Req 8.1 — the Postgres User_Sync SQL uses bound parameters only.
test('Req 8.1: Postgres User_Sync SQL uses bound parameters only, no interpolation', () => {
  const section = postgresUserSyncSection();

  // Sanity: we sliced the right block — both methods are present.
  assert.match(section, /async ensureLocalUser\b/, 'postgres.ts should define ensureLocalUser');
  assert.match(section, /async getLocalUser\b/, 'postgres.ts should define getLocalUser');

  // Positive: the upsert binds id/email/role through $1/$2/$3 placeholders.
  for (const ph of ['$1', '$2', '$3']) {
    assert.ok(section.includes(ph), `User_Sync SQL must bind values via a ${ph} placeholder (Req 8.1)`);
  }
  // It is the parameterized upsert the design specifies.
  assert.match(section, /INSERT INTO users/, 'User_Sync must INSERT INTO users');
  assert.match(section, /ON CONFLICT \(id\)/, 'User_Sync must upsert ON CONFLICT (id)');

  // Negative: no template-literal interpolation (`${…}`) anywhere in these
  // methods — that is the shape that would splice an input value into SQL text.
  assert.ok(
    !section.includes('${'),
    'Postgres User_Sync must not interpolate values into SQL via template literals (Req 8.1)',
  );
  // Negative: no string concatenation building SQL from input (e.g. `' + id`).
  assert.doesNotMatch(
    section,
    /['"`]\s*\+\s*\w/,
    'Postgres User_Sync must not concatenate input into SQL strings (Req 8.1)',
  );
});

// Req 7.5 — User_Sync queries live only in postgres.ts; memory.ts carries no SQL.
test('Req 7.5: the User_Sync upsert SQL exists only in postgres.ts, never elsewhere', () => {
  const files = listTsFiles(srcDir);
  const offenders = files.filter(
    (f) => f !== postgresPath && readFileSync(f, 'utf8').includes('INSERT INTO users'),
  );
  assert.deepEqual(
    offenders.map((f) => f.slice(srcDir.length + 1)),
    [],
    'the "INSERT INTO users" upsert must exist only in infra/postgres.ts (Req 7.5)',
  );

  // The in-memory driver's User_Sync path is a Map, not a query — it must carry
  // no SQL of any kind (no INSERT/SELECT/UPDATE text, no .query() call).
  const mem = readFileSync(memoryPath, 'utf8');
  assert.doesNotMatch(mem, /\.query\s*\(/i, 'memory.ts must issue no DB query (Req 7.5)');
  assert.doesNotMatch(
    mem,
    /\bINSERT\s+INTO\b|\bSELECT\b[\s\S]*\bFROM\b/i,
    'memory.ts must contain no SQL — its User_Sync path is an in-memory Map (Req 7.5)',
  );
});

// Req 10.2 — neutrality of the LocalUser shape, proven two ways.
test('Req 10.2: LocalUser exposes only id/email/role/createdAt at runtime (no verdict/rating)', async () => {
  // Round-trip the actual stored shape through the real driver — the strongest
  // evidence: whatever ensureLocalUser persists is exactly what getLocalUser
  // returns, and its key set is fixed.
  const repo = new InMemoryRepository();
  await repo.ensureLocalUser({ id: 'a1b2c3d4-0000-4000-8000-000000000001', email: 'reader@example.org', role: 'user' });
  const user = await repo.getLocalUser('a1b2c3d4-0000-4000-8000-000000000001');
  assert.ok(user, 'getLocalUser should return the synced Local_User');
  assert.deepEqual(
    Object.keys(user!).sort(),
    ['createdAt', 'email', 'id', 'role'],
    'LocalUser must expose exactly id/email/role/createdAt — no verdict or rating field (Req 10.2)',
  );
});

test('Req 10.2: the LocalUser interface declares no verdict/rating field', () => {
  const src = readFileSync(portsPath, 'utf8');
  const start = src.indexOf('export interface LocalUser {');
  assert.ok(start !== -1, 'ports.ts should declare the LocalUser interface');
  const bodyStart = src.indexOf('{', start) + 1;
  const bodyEnd = src.indexOf('}', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'LocalUser interface body should be well-formed');
  const body = src.slice(bodyStart, bodyEnd);

  // Collect the declared field names, ignoring `//` comment lines (the header
  // comment legitimately names "verdict"/"rating" while saying they are absent).
  const fields = body
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.match(/^(\w+)\s*[?:]/)?.[1])
    .filter((n): n is string => Boolean(n));

  assert.deepEqual(
    fields.sort(),
    ['createdAt', 'email', 'id', 'role'],
    'LocalUser must declare exactly id/email/role/createdAt (Req 10.2)',
  );
  // Belt-and-suspenders: no compass-forbidden concept appears as a field name.
  for (const banned of ['verdict', 'rating', 'reliability', 'truthfulness', 'score']) {
    assert.ok(
      !fields.some((f) => f.toLowerCase().includes(banned)),
      `LocalUser must carry no "${banned}" field (compass / Req 10.2)`,
    );
  }
});
