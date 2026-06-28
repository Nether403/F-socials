// Feature: expert-review-queue, Neutrality_Check (static smoke)
// Validates: Requirements 7.4, 9.1, 9.2, 9.5
//
// Lens, not a judge: the review workflow's surfaces must carry NO creator-reliability
// dimension and NO truthfulness verdict — no column, enum value, route field, outcome
// value, or UI label expressing a reliability rating or a truth/falsity verdict tied to
// a content creator, channel, or author. Property 9 (review.neutrality.prop.test.ts)
// guarantees this at runtime over generated resolutions; this static check pins the
// SOURCE so the dimension cannot be reintroduced in the migration DDL, the resolution
// vocabulary, or the Reviewer Console labels.
//
// We inspect the actual source text of:
//   - the migration db/migrations/005_review_workflow.sql (columns + enum values)   (Req 7.4, 9.1)
//   - the Resolution_Outcome vocabulary src/core/reviewOutcome.ts                    (Req 9.2)
//   - the resolution vocab VALUES themselves (imported at runtime)                   (Req 9.2)
//   - the Reviewer Console labels web/src/components/ReviewerConsole.tsx IF present  (Req 9.2, 9.5)
//     (task 12.2 is downstream of this one — the file may not exist yet, so it is
//      scanned only when present and its absence is NOT a failure. The final
//      checkpoint reruns everything once the console lands.)
//
// Comments are stripped before scanning so the prose that legitimately discusses (and
// forbids) the dimension never trips the scan; only executable code / DDL is left.
// The banned-token set mirrors reportGraph.neutralityStatic.test.ts exactly:
// sourceTier is allowed (it attaches to sources, the neutral compass-sanctioned use);
// what is forbidden is a creator/channel/author entity or a reliability/truthfulness
// verdict. NOTE: reviewOutcome.ts carries a self-check with a literal banned-token
// array in CODE (not a comment), so for that module we scan the exported vocabulary
// block and the vocab VALUES, never the whole file, to avoid the scaffolding tripping
// the scan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLUTION_OUTCOMES } from '../src/core/reviewOutcome';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(serverDir, '..', '..', 'db', 'migrations', '005_review_workflow.sql');
const reviewOutcomePath = join(serverDir, 'src', 'core', 'reviewOutcome.ts');
const consolePath = join(serverDir, '..', 'web', 'src', 'components', 'ReviewerConsole.tsx');

// Remove TS/TSX line + block comments so prose (which legitimately names the forbidden
// dimension) never trips the scan; only executable code is left behind.
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// Remove SQL line (`-- ...`) and block comments.
function stripSqlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// A content-creator / channel / author entity has no place in a workflow that reviews
// claims and sources. Matched as prefixes (`\w*`) so snake_case columns like
// `creator_reliability` or `channel_tier` are caught — `\b...\b` would miss them
// because `_` counts as a word char. `author` carries a lookahead so it does not fire
// on legitimate auth words (authorization, authorize). (Identical to reportGraph's.)
const CREATOR_ENTITY = /\b(creator|channel|uploader|publisher|persona)\w*|\bauthor(?!ization|ize|ised|ized)\w*/i;

// A reliability / credibility / truthfulness verdict — a judgement of correctness.
// `sourceTier` (a tier on a SOURCE) is deliberately NOT in here: tiers on sources are
// the neutral, allowed signal. This catches a *rating/verdict* dimension instead.
// (Identical to reportGraph's.)
const RELIABILITY_VERDICT = /truthful|reliabilit|credibilit|trustworth|\bverdict\b|\bveracity\b/i;

function assertNeutral(label: string, code: string): void {
  const creatorHit = code.match(CREATOR_ENTITY);
  assert.equal(
    creatorHit,
    null,
    `${label} introduces a creator/channel/author entity: "${creatorHit?.[0]}". ` +
      `f-Socials is a lens, not a judge — the review workflow describes claims and sources, never people.`,
  );
  const verdictHit = code.match(RELIABILITY_VERDICT);
  assert.equal(
    verdictHit,
    null,
    `${label} introduces a reliability/truthfulness verdict: "${verdictHit?.[0]}". ` +
      `Source tiers attach to sources only; no reliability rating may be expressed.`,
  );
}

test('Req 7.4/9.1: migration 005 adds no creator-reliability column or enum value', () => {
  const ddl = stripSqlComments(readFileSync(migrationPath, 'utf8'));
  // Sanity: it is the review-workflow migration touching the intake tables.
  assert.match(ddl, /disputes|flags/i, '005 should touch the disputes/flags tables');
  assert.match(ddl, /review_status_kind|resolution_outcome/i, '005 should declare the review enums');
  assertNeutral('005_review_workflow.sql', ddl);

  // Column-level guard: no ADD COLUMN names a creator/author/channel reliability column.
  const addColumns = [...ddl.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map(
    (m) => m[1] ?? '',
  );
  assert.ok(addColumns.length > 0, '005 should add review columns');
  for (const col of addColumns) {
    assert.doesNotMatch(
      col,
      /creator|author|channel|reliab|credib|verdict|truth/i,
      `migration 005 adds a forbidden creator-reliability column: "${col}"`,
    );
  }

  // Enum-value guard: scan every quoted enum literal in the DDL (the enumerated
  // review-status and resolution-outcome values) for a truthfulness verdict.
  const enumValues = [...ddl.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((m) => m[1] ?? '');
  assert.ok(enumValues.length > 0, '005 should declare enum values');
  for (const value of enumValues) {
    assert.doesNotMatch(
      value,
      /\b(true|false|accurate|inaccurate|misinformation|disinformation|fake|reliable|unreliable|credib|truth|verdict)\b/i,
      `migration 005 declares a forbidden truthfulness/reliability enum value: "${value}"`,
    );
  }
});

test('Req 9.2: the Resolution_Outcome vocabulary source carries no creator-reliability dimension', () => {
  const full = readFileSync(reviewOutcomePath, 'utf8');

  // Slice ONLY the exported tuple block. The module's runnable self-check declares a
  // literal banned-token array in code (e.g. 'trustworth') as scaffolding; that is not
  // a surfaced field/value, so scanning the whole file would false-positive. The
  // vocabulary block is the load-bearing surface to pin against reintroduction.
  const start = full.indexOf('export const RESOLUTION_OUTCOMES');
  assert.ok(start !== -1, 'reviewOutcome.ts should export RESOLUTION_OUTCOMES');
  const end = full.indexOf('as const', start);
  assert.ok(end !== -1 && end > start, 'RESOLUTION_OUTCOMES should be a `const` tuple');
  const block = stripTsComments(full.slice(start, end));

  assertNeutral('reviewOutcome.ts RESOLUTION_OUTCOMES block', block);
});

test('Req 9.2: the resolution vocab values themselves are framing/evidence-only', () => {
  // Scan the actual runtime vocabulary — the values that reach the schema, the routes,
  // and the console — so a regression in the published set fails here regardless of the
  // surrounding source text.
  assert.ok(RESOLUTION_OUTCOMES.length > 0, 'RESOLUTION_OUTCOMES must be non-empty');
  for (const outcome of RESOLUTION_OUTCOMES) {
    assertNeutral(`resolution outcome "${outcome}"`, outcome);
    assert.doesNotMatch(
      outcome,
      /\b(true|false|accurate|inaccurate|misinformation|disinformation|fake|reliable|unreliable)\b/i,
      `resolution outcome "${outcome}" asserts a truthfulness verdict`,
    );
  }
});

test('Req 9.2/9.5: Reviewer Console labels carry no creator-reliability dimension (when present)', () => {
  // Task 12.2 is downstream — guard with an existence check. When the console does not
  // exist yet this is a graceful skip (NOT a failure); the final checkpoint reruns this
  // once the file lands so the labels are pinned then.
  if (!existsSync(consolePath)) {
    return; // ponytail: console not built yet (task 12.2); scanned on the next run.
  }
  const code = stripTsComments(readFileSync(consolePath, 'utf8'));
  assertNeutral('web ReviewerConsole.tsx', code);
});
