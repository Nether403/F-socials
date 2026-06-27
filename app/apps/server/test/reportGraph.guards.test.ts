// Feature: report-graph-normalization, static guards smoke test.
// Validates: Requirements 10.1, 7.1, 6.2
//
// A dependency-free static/smoke test (node:test, no fast-check) that proves the
// feature only ever *verifies* the moat, never weakens it, and stays within the
// project's persistence conventions:
//   10.1 The invariant gate in core/assemble.ts is unmodified — its pinned
//        behaviour still holds, so assertInvariantGateIntact() does not throw.
//   7.1  Migration 004_*.sql exists and lexically sorts after 003_audit_records.sql,
//        so `npm run migrate` applies it in order.
//   6.2  The Postgres writeReportGraph dual-write uses parameterized SQL only —
//        $1..$n placeholders, no template-literal interpolation building SQL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInvariantGateIntact } from '../src/router/guard';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// serverDir = app/apps/server; migrations live at app/db/migrations.
const migrationsDir = resolve(serverDir, '..', '..', 'db', 'migrations');
const postgresSrc = join(serverDir, 'src', 'infra', 'postgres.ts');

// Req 10.1 — assemble.ts unmodified / the gate's pinned behaviour is intact.
// assertInvariantGateIntact() runs the real core/assemble.ts gate against its
// pinned fixtures and throws if the gate ever diverged (was weakened/edited).
// A passing call is the behavioural proof the gate is unmodified.
test('the invariant gate retains its pinned behaviour (assemble.ts unmodified) — Req 10.1', () => {
  assert.doesNotThrow(() => assertInvariantGateIntact());
});

// Req 7.1 — Migration_004 exists and applies in order after 003_audit_records.sql.
test('migration 004_*.sql exists and sorts lexically after 003_audit_records.sql — Req 7.1', () => {
  const files = readdirSync(migrationsDir);
  const m004 = files.find((f) => /^004_.*\.sql$/.test(f));
  assert.ok(m004, 'a 004_*.sql migration file should exist in db/migrations');
  assert.ok(
    m004! > '003_audit_records.sql',
    `${m004} should sort lexically after 003_audit_records.sql (migrate order)`,
  );
});

// Req 6.2 — the dual-write SQL is parameterized only (no string interpolation).
test('writeReportGraph uses $1..$n placeholders with no SQL string interpolation — Req 6.2', () => {
  const src = readFileSync(postgresSrc, 'utf8');

  // Scope to the writeReportGraph method: from its declaration up to the next
  // method (hasReportGraph). This isolates the dual-write SQL from the rest of
  // the file so the check is about the new persistence path specifically.
  const start = src.indexOf('private async writeReportGraph');
  const end = src.indexOf('async hasReportGraph', start);
  assert.ok(start >= 0, 'writeReportGraph method should be present in postgres.ts');
  assert.ok(end > start, 'hasReportGraph should follow writeReportGraph');
  const writeBody = src.slice(start, end);

  // Positive: the INSERT/DELETE statements bind values through $1..$n placeholders.
  assert.match(writeBody, /\$\d+/, 'writeReportGraph SQL must use $1..$n placeholders');

  // Negative: no template-literal interpolation (`${...}`) anywhere in the method —
  // that is the shape that would splice a value straight into a SQL string.
  assert.ok(
    !writeBody.includes('${'),
    'writeReportGraph must not interpolate values into SQL via template literals',
  );

  // The backfill-support helpers added alongside the dual-write must also stay
  // interpolation-free (hasReportGraph is parameterized; listReportIds takes none).
  const helpersStart = src.indexOf('async hasReportGraph');
  const helpersEnd = src.indexOf('async getReport', helpersStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'backfill helpers should be present');
  const helpersBody = src.slice(helpersStart, helpersEnd);
  assert.match(helpersBody, /\$1/, 'hasReportGraph must use a $1 placeholder');
  assert.ok(
    !helpersBody.includes('${'),
    'backfill helper SQL must not interpolate values via template literals',
  );
});
