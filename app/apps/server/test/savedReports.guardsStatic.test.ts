// Feature: accounts-save-history, static architectural guards (smoke).
// Validates: Requirements 11.1, 11.5, 13.1, 13.2, 13.4
//
// A dependency-free static/smoke test (node:test, no fast-check) proving this
// feature only ever *verifies* the moat and stays inside the project's
// persistence conventions:
//
//   13.1  core/assemble.ts is byte-for-byte unchanged — its content hashes to a
//         pinned value, so a single edited byte fails here.
//   13.2  The invariant gate's behaviour is intact (assertInvariantGateIntact),
//         so readiness is consumed exactly as assigned, never recomputed.
//   13.4  The analysis pipeline's stages are unaltered — every stage marker is
//         present and in its original order in pipeline/stages.ts.
//   11.1  The saved-report route handlers contain no direct DB query — every
//         read/write goes through Repository methods (grep the route section).
//   11.5  The three Postgres saved-report methods use parameterized SQL only —
//         $1..$n placeholders, never string interpolation of input values (grep).
//
// Mirrors the established convention in reportGraph.guards.test.ts /
// reportGraph.neutralityStatic.test.ts: resolve paths from import.meta.url, read
// the real source text, slice the load-bearing section, and assert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInvariantGateIntact } from '../src/router/guard';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assemblePath = join(serverDir, 'src', 'core', 'assemble.ts');
const stagesPath = join(serverDir, 'src', 'pipeline', 'stages.ts');
const routesPath = join(serverDir, 'src', 'http', 'routes.ts');
const postgresPath = join(serverDir, 'src', 'infra', 'postgres.ts');

// SHA-256 of core/assemble.ts content at the start of this feature, with line
// endings normalized to '\n'. Normalizing makes the pin robust to git autocrlf
// checkout differences while still failing on any real content change — the
// guard is about the gate's logic, not the platform's newline byte.
// To re-pin after an INTENTIONAL, reviewed gate change (which Req 13.1 forbids
// for THIS feature): node -e "console.log(require('crypto').createHash('sha256')
//   .update(require('fs').readFileSync('src/core/assemble.ts','utf8')
//   .replace(/\r\n/g,'\n'),'utf8').digest('hex'))"
const ASSEMBLE_SHA256 = 'dd7664bfc39abedad6581f7713fa903834aec30d8330d8ae0ccb2abc59574b6d';

function normalize(src: string): string {
  return src.replace(/\r\n/g, '\n');
}

// Req 13.1 — assemble.ts is byte-for-byte unchanged (pinned content hash).
test('Req 13.1: core/assemble.ts content is byte-for-byte unchanged (pinned hash)', () => {
  const content = normalize(readFileSync(assemblePath, 'utf8'));
  const actual = createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(
    actual,
    ASSEMBLE_SHA256,
    'core/assemble.ts has changed. The invariant gate is the codified moat and is ' +
      'read-only for accounts-save-history (Req 13.1). If this change was made by this ' +
      'feature, revert it; the feature must satisfy the gate by construction, never edit it.',
  );
});

// Req 13.2 — the gate's pinned behaviour holds (readiness consumed as assigned).
test('Req 13.2: the invariant gate retains its pinned behaviour (readiness not recomputed)', () => {
  assert.doesNotThrow(() => assertInvariantGateIntact());
});

// Req 13.4 — the analysis pipeline's stages are unaltered: all five stage markers
// are present and appear in their original order. Re-ordering, removing, or
// renaming a stage moves/loses a marker and fails here.
test('Req 13.4: the analysis pipeline stages are present and in order', () => {
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
      `pipeline stage "${marker}" is out of order — stages must not be reordered (Req 13.4)`,
    );
    cursor = at;
  }
  // The gate is invoked as the final stage and its result is returned unchanged
  // (spread), never re-derived — the literal call must still be present.
  assert.match(src, /assembleReport\(/, 'stages.ts must still call assembleReport (the gate)');
});

// Req 11.1 — the saved-report route handlers contain no direct DB query. Slice the
// "Saved reports" route section (between its banner and the next route group) and
// assert it touches persistence only through deps.repo.* — no pool/client/SQL.
test('Req 11.1: saved-report route handlers contain no direct DB query', () => {
  const src = readFileSync(routesPath, 'utf8');
  const start = src.indexOf('--- Saved reports (accounts-save-history)');
  const end = src.indexOf('--- Review workflow (expert-review-queue)');
  assert.ok(start !== -1, 'routes.ts should contain the Saved reports route section');
  assert.ok(end !== -1 && end > start, 'a route section should follow the Saved reports section');
  const section = src.slice(start, end);

  // Sanity: we sliced the right block — the three saved-report routes are here.
  assert.match(section, /\/analyses\/:id\/save/, 'save route should be in the saved-reports section');
  assert.match(section, /\/saved-reports/, 'history route should be in the saved-reports section');

  // The handlers must go through Repository methods only.
  for (const repoCall of ['repo.saveSavedReport', 'repo.removeSavedReport', 'repo.listSavedReports']) {
    assert.ok(section.includes(repoCall), `saved-report handlers should call deps.${repoCall}`);
  }

  // Negative: no raw DB access of any kind in the route handlers (Req 11.1).
  // A direct query is impossible without a pool/client and a .query() call, and
  // an inline SQL string would carry a $1 bind placeholder — so these three
  // markers cover every direct-DB shape without tripping on prose or the
  // router.delete/.post method names.
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
      `saved-report route handlers must not issue direct DB queries (found ${what}); ` +
        `all persistence goes through Repository methods (Req 11.1)`,
    );
  }
});

// Req 11.5 — the three Postgres saved-report methods use parameterized SQL only.
// Slice from the "Saved reports" banner to the end of the class and assert each
// method binds via $1..$n with no template-literal interpolation of values.
test('Req 11.5: Postgres saved-report methods use parameterized SQL only', () => {
  const src = readFileSync(postgresPath, 'utf8');
  const start = src.indexOf('Saved reports (accounts-save-history)');
  assert.ok(start !== -1, 'postgres.ts should contain the Saved reports section');
  const section = src.slice(start);

  // Sanity: the three methods are all present in the sliced section.
  for (const method of ['saveSavedReport', 'removeSavedReport', 'listSavedReports']) {
    assert.match(section, new RegExp(`async ${method}\\b`), `postgres.ts should define ${method}`);
  }

  // Positive: the section binds caller values through $1..$n placeholders.
  assert.match(section, /\$1/, 'saved-report SQL must use a $1 placeholder');
  assert.match(section, /\$2/, 'save/remove SQL must bind reader_id and report_id via $1/$2');

  // Negative: no template-literal interpolation (`${...}`) anywhere in these
  // methods — that is the shape that would splice an input value into SQL text.
  assert.ok(
    !section.includes('${'),
    'Postgres saved-report methods must not interpolate values into SQL via template literals (Req 11.5)',
  );

  // Negative: no string concatenation building SQL from input (e.g. `' + reader`),
  // and the table name is a literal, never assembled from a variable.
  assert.doesNotMatch(
    section,
    /['"`]\s*\+\s*\w/,
    'Postgres saved-report methods must not concatenate input into SQL strings (Req 11.5)',
  );
});
