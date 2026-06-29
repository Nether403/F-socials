// Feature: institutional-workspace, static architectural guards (smoke).
// Validates: Requirements 9.1, 9.5, 9.6, 11.1, 11.2, 11.4
//
// A dependency-free static/smoke test (node:test, no fast-check) proving this
// feature only ever *verifies* the moat and stays inside the project's
// persistence conventions:
//
//   11.1  core/assemble.ts is byte-for-byte unchanged — its content hashes to a
//         pinned value, so a single edited byte fails here.
//   11.2  The invariant gate's behaviour is intact (assertInvariantGateIntact),
//         so readiness is consumed exactly as assigned, never recomputed.
//   11.4  The analysis pipeline's stages are unaltered — every stage marker is
//         present and in its original order in pipeline/stages.ts (no stage added,
//         removed, reordered, or modified).
//   9.1   The workspace route handlers contain no direct DB query — every read/
//         write goes through Repository methods (grep the workspace route section).
//   9.6   The Postgres workspace methods use parameterized SQL only — $1..$n
//         placeholders, never string interpolation of input values (grep).
//   9.5   Migration 007_workspaces.sql keys the reader/owner/author columns as
//         TEXT (the Supabase JWT subject), following the 006 convention, and
//         applies lexically after 006_saved_reports.sql.
//
// Mirrors the established convention in savedReports.guardsStatic.test.ts /
// reportGraph.guards.test.ts: resolve paths from import.meta.url, read the real
// source text, slice the load-bearing section, and assert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInvariantGateIntact } from '../src/router/guard';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assemblePath = join(serverDir, 'src', 'core', 'assemble.ts');
const stagesPath = join(serverDir, 'src', 'pipeline', 'stages.ts');
const routesPath = join(serverDir, 'src', 'http', 'routes.ts');
const postgresPath = join(serverDir, 'src', 'infra', 'postgres.ts');
// serverDir = app/apps/server; migrations live at app/db/migrations.
const migrationsDir = resolve(serverDir, '..', '..', 'db', 'migrations');

// SHA-256 of core/assemble.ts content at the start of this feature, with line
// endings normalized to '\n'. Normalizing makes the pin robust to git autocrlf
// checkout differences while still failing on any real content change — the
// guard is about the gate's logic, not the platform's newline byte. This is the
// same pinned value asserted by savedReports.guardsStatic.test.ts; the gate is
// read-only for institutional-workspace too (Req 11.1).
// To re-pin after an INTENTIONAL, reviewed gate change (which Req 11.1 forbids
// for THIS feature): node -e "console.log(require('crypto').createHash('sha256')
//   .update(require('fs').readFileSync('src/core/assemble.ts','utf8')
//   .replace(/\r\n/g,'\n'),'utf8').digest('hex'))"
const ASSEMBLE_SHA256 = 'dd7664bfc39abedad6581f7713fa903834aec30d8330d8ae0ccb2abc59574b6d';

function normalize(src: string): string {
  return src.replace(/\r\n/g, '\n');
}

// Remove SQL line (`-- ...`) and block comments so the prose header (which
// legitimately names "TEXT") never satisfies the column-type scan; only DDL is left.
function stripSqlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Req 11.1 — assemble.ts is byte-for-byte unchanged (pinned content hash).
test('Req 11.1: core/assemble.ts content is byte-for-byte unchanged (pinned hash)', () => {
  const content = normalize(readFileSync(assemblePath, 'utf8'));
  const actual = createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(
    actual,
    ASSEMBLE_SHA256,
    'core/assemble.ts has changed. The invariant gate is the codified moat and is ' +
      'read-only for institutional-workspace (Req 11.1). If this change was made by this ' +
      'feature, revert it; the feature must satisfy the gate by construction, never edit it.',
  );
});

// Req 11.2 — the gate's pinned behaviour holds (readiness consumed as assigned).
test('Req 11.2: the invariant gate retains its pinned behaviour (readiness not recomputed)', () => {
  assert.doesNotThrow(() => assertInvariantGateIntact());
});

// Req 11.4 — the analysis pipeline's stages are unaltered: all five stage markers
// are present and appear in their original order. Adding, removing, re-ordering,
// or renaming a stage moves/loses a marker and fails here.
test('Req 11.4: the analysis pipeline stages are present and in order (no stage added/removed/reordered/modified)', () => {
  const src = normalize(readFileSync(stagesPath, 'utf8'));
  const stageMarkers = [
    'Stage 1: transcript',
    'Stage 2: LLM extraction',
    'Stage 3: verify each claim',
    'Stage 4: bridging perspectives',
    'Stage 5: assemble + invariant gate',
  ];
  let cursor = -1;
  for (const marker of stageMarkers) {
    const at = src.indexOf(marker);
    assert.notEqual(at, -1, `pipeline stage marker missing or renamed: "${marker}"`);
    assert.ok(
      at > cursor,
      `pipeline stage "${marker}" is out of order — stages must not be reordered (Req 11.4)`,
    );
    cursor = at;
  }
  // The gate is invoked as the final stage and its result is returned unchanged,
  // never re-derived — the literal call must still be present.
  assert.match(src, /assembleReport\(/, 'stages.ts must still call assembleReport (the gate)');
});

// Req 9.1 — the workspace route handlers contain no direct DB query. Slice the
// "Institutional workspace" route section (between its banner and the next route,
// the public /policy descriptor) and assert it touches persistence only through
// deps.repo.* — no pool/client/SQL.
test('Req 9.1: workspace route handlers contain no direct DB query', () => {
  const src = readFileSync(routesPath, 'utf8');
  const start = src.indexOf('--- Institutional workspace (institutional-workspace)');
  const end = src.indexOf("router.get('/policy'", start);
  assert.ok(start !== -1, 'routes.ts should contain the Institutional workspace route section');
  assert.ok(end !== -1 && end > start, 'a route section should follow the Institutional workspace section');
  const section = src.slice(start, end);

  // Sanity: we sliced the right block — representative workspace routes are here.
  assert.match(section, /router\.post\('\/workspaces'/, 'create-workspace route should be in the section');
  assert.match(section, /\/collections\/:cid\/items/, 'collection-items route should be in the section');
  assert.match(section, /\/annotations/, 'annotation routes should be in the section');

  // The handlers must go through Repository methods only. (workspaceExists /
  // getMembership are reached via the shared loadMembership guard defined above
  // this section, so they are asserted through that call rather than directly.)
  assert.match(section, /loadMembership\(/, 'workspace handlers should gate through loadMembership');
  for (const repoCall of [
    'repo.createWorkspace',
    'repo.listWorkspacesForReader',
    'repo.createInvite',
    'repo.redeemInvite',
    'repo.addCollectionItem',
    'repo.createAnnotation',
  ]) {
    assert.ok(section.includes(repoCall), `workspace handlers should call deps.${repoCall}`);
  }

  // Negative: no raw DB access of any kind in the route handlers (Req 9.1). A
  // direct query is impossible without a pool/client and a .query() call, and an
  // inline SQL string would carry a $1 bind placeholder — these markers cover
  // every direct-DB shape without tripping on prose or the router.delete/.post
  // method names.
  const forbidden: Array<[RegExp, string]> = [
    [/\bpool\b/i, 'a Postgres pool reference'],
    [/\bclient\.\b/i, 'a DB client reference'],
    [/\.query\s*\(/i, 'a direct .query() call'],
    [/`[^`]*\$\d/, 'an inline parameterized SQL string'],
  ];
  for (const [pattern, what] of forbidden) {
    assert.doesNotMatch(
      section,
      pattern,
      `workspace route handlers must not issue direct DB queries (found ${what}); ` +
        `all persistence goes through Repository methods (Req 9.1)`,
    );
  }
});

// Req 9.6 — the Postgres workspace methods use parameterized SQL only. Slice from
// the "Institutional workspace" banner to the end of the class and assert each
// query binds via $1..$n with no template-literal interpolation of input values.
test('Req 9.6: Postgres workspace methods use parameterized SQL only', () => {
  const src = readFileSync(postgresPath, 'utf8');
  const start = src.indexOf('Institutional workspace (institutional-workspace)');
  assert.ok(start !== -1, 'postgres.ts should contain the Institutional workspace section');
  const section = src.slice(start);

  // Sanity: the workspace methods are all present in the sliced section.
  for (const method of [
    'createWorkspace',
    'listWorkspacesForReader',
    'getMembership',
    'workspaceExists',
    'listMembers',
    'removeMember',
    'createInvite',
    'redeemInvite',
    'createCollection',
    'listCollections',
    'deleteCollection',
    'addCollectionItem',
    'removeCollectionItem',
    'listCollectionItems',
    'createAnnotation',
    'listAnnotations',
    'getAnnotation',
    'updateAnnotation',
    'deleteAnnotation',
  ]) {
    assert.match(section, new RegExp(`async ${method}\\b`), `postgres.ts should define ${method}`);
  }

  // Positive: the section binds caller values through $1..$n placeholders.
  assert.match(section, /\$1/, 'workspace SQL must use a $1 placeholder');
  assert.match(section, /\$2/, 'workspace SQL must bind multiple values via $1/$2');

  // Negative: no template-literal interpolation (`${...}`) anywhere in these
  // methods — that is the shape that would splice an input value into SQL text.
  // This must hold in every environment, including development and test (Req 9.6).
  assert.ok(
    !section.includes('${'),
    'Postgres workspace methods must not interpolate values into SQL via template literals (Req 9.6)',
  );

  // Negative: no string concatenation building SQL from input (e.g. `' + reader`),
  // so a table/column name is never assembled from a variable.
  assert.doesNotMatch(
    section,
    /['"`]\s*\+\s*\w/,
    'Postgres workspace methods must not concatenate input into SQL strings (Req 9.6)',
  );
});

// Req 9.5 / 9.4 — migration 007 exists, applies lexically after 006_saved_reports.sql,
// and keys the reader/owner/author identity columns as TEXT (Supabase JWT subject),
// following the convention established by 006.
test('Req 9.5: migration 007 keys reader/owner/author columns as TEXT following 006', () => {
  const files = readdirSync(migrationsDir);
  const m007 = files.find((f) => /^007_.*\.sql$/.test(f));
  assert.ok(m007, 'a 007_*.sql migration file should exist in db/migrations');
  assert.ok(
    m007! > '006_saved_reports.sql',
    `${m007} should sort lexically after 006_saved_reports.sql (migrate order, Req 9.4)`,
  );

  // Inspect DDL only — comments (which legitimately mention "TEXT") are stripped.
  const ddl = stripSqlComments(readFileSync(join(migrationsDir, m007!), 'utf8'));

  // Each Supabase-subject identity column must be declared TEXT, matching 006.
  for (const col of ['owner_id', 'reader_id', 'author_id']) {
    assert.match(
      ddl,
      new RegExp(`\\b${col}\\s+TEXT\\b`, 'i'),
      `migration 007 must declare ${col} as TEXT (Supabase JWT subject, following 006) (Req 9.5)`,
    );
  }
});
