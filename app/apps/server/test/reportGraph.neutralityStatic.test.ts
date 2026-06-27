// Feature: report-graph-normalization, Neutrality_Check (static smoke)
// Validates: Requirements 9.1, 9.3, 7.4
//
// Lens, not judge: the normalized schema must carry NO creator-reliability
// dimension — no column, field, or value expressing a reliability rating or
// truthfulness verdict tied to a content creator, channel, or author. Property 7
// guarantees this at runtime over generated reports; this static check pins the
// SOURCE so the dimension cannot be reintroduced in the type definitions, the
// projection code, or the migration DDL.
//
// We inspect the actual source text of:
//   - the normalized row-type block in src/types.ts (ClaimRow/CitationRow/PerspectiveRow)
//   - the projection module src/core/reportGraph.ts
//   - the migration db/migrations/004_report_graph.sql
//
// Comments are stripped before scanning so the assertions react to CODE/DDL only,
// never to the prose that legitimately discusses (and forbids) the dimension.
// sourceTier is explicitly allowed — it attaches to sources (citations /
// perspectives), which is the neutral, compass-sanctioned use. The check is the
// presence of a creator/author/channel entity, or a reliability/credibility/
// truthfulness verdict, anywhere in the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const typesPath = join(serverDir, 'src', 'types.ts');
const reportGraphPath = join(serverDir, 'src', 'core', 'reportGraph.ts');
const migrationPath = join(serverDir, '..', '..', 'db', 'migrations', '004_report_graph.sql');

// Remove TS line + block comments so prose (which legitimately names the forbidden
// dimension) never trips the scan; only executable code is left behind.
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// Remove SQL line (`-- ...`) and block comments.
function stripSqlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// A content-creator / channel / author entity has no place in a graph that
// describes claims and sources. If any of these surface in code or DDL, a
// person-level dimension is being introduced.
// Tokens are matched as prefixes (`\w*`) so snake_case columns like
// `channel_tier` or `creator_reliability` are caught — `\b...\b` would miss them
// because `_` counts as a word char. `author` carries a lookahead so it does not
// fire on legitimate auth words (authorization, authorize).
const CREATOR_ENTITY = /\b(creator|channel|uploader|publisher|persona)\w*|\bauthor(?!ization|ize|ised|ized)\w*/i;

// A reliability / credibility / truthfulness verdict — a judgement of correctness.
// `sourceTier` (a tier on a SOURCE) is deliberately NOT in here: tiers on sources
// are the neutral, allowed signal. This catches a *rating* dimension instead.
const RELIABILITY_VERDICT = /truthful|reliabilit|credibilit|trustworth|\bverdict\b|\bveracity\b/i;

function assertNeutral(label: string, code: string): void {
  const creatorHit = code.match(CREATOR_ENTITY);
  assert.equal(
    creatorHit,
    null,
    `${label} introduces a creator/channel/author entity: "${creatorHit?.[0]}". ` +
      `f-Socials is a lens, not a judge — the normalized graph describes claims and sources, never people.`,
  );
  const verdictHit = code.match(RELIABILITY_VERDICT);
  assert.equal(
    verdictHit,
    null,
    `${label} introduces a reliability/truthfulness verdict: "${verdictHit?.[0]}". ` +
      `Source tiers attach to sources only; no reliability rating may be expressed.`,
  );
}

test('Req 9.1/9.3: normalized row types carry no creator-reliability dimension', () => {
  const full = readFileSync(typesPath, 'utf8');

  // Slice just the normalized-row-types block so the check is precise and is not
  // diluted by the rest of the file. Markers are stable section headers.
  const start = full.indexOf('Normalized row types');
  const end = full.indexOf('Claim_Verification_Router types');
  assert.ok(start !== -1, 'types.ts should contain the normalized row-types section');
  assert.ok(end !== -1 && end > start, 'types.ts should contain a section after the normalized block');
  const block = stripTsComments(full.slice(start, end));

  // The three normalized row interfaces must all be present (we are checking the right block).
  for (const iface of ['ClaimRow', 'CitationRow', 'PerspectiveRow']) {
    assert.match(block, new RegExp(`interface ${iface}`), `normalized block should define ${iface}`);
  }

  assertNeutral('types.ts normalized block', block);

  // Key assertion (design): a ClaimRow describes a CLAIM, so it must carry no
  // source-tier and no reliability field — a tier/reliability on a claim would be
  // a verdict on the claim's author/content. Extract the ClaimRow body and assert
  // it declares no such field.
  const claimRowMatch = stripTsComments(full).match(/interface\s+ClaimRow\s*\{([\s\S]*?)\}/);
  assert.ok(claimRowMatch, 'ClaimRow interface should be present in types.ts');
  const claimRowBody = claimRowMatch[1] ?? '';
  assert.doesNotMatch(
    claimRowBody,
    /tier/i,
    'ClaimRow must not carry a sourceTier/tier field — tiers attach to sources, never to a claim',
  );
  assert.doesNotMatch(
    claimRowBody,
    /reliab|credib|verdict|rating|truth/i,
    'ClaimRow must not carry a reliability/credibility/verdict/rating field',
  );
});

test('Req 9.3: the projectReportGraph source has no creator-reliability dimension', () => {
  const code = stripTsComments(readFileSync(reportGraphPath, 'utf8'));
  // Sanity: we are inspecting the projection we think we are.
  assert.match(code, /projectReportGraph/, 'reportGraph.ts should define projectReportGraph');
  assertNeutral('core/reportGraph.ts', code);
});

test('Req 7.4/9.1: migration 004 adds no creator-reliability column', () => {
  const ddl = stripSqlComments(readFileSync(migrationPath, 'utf8'));
  // Sanity: it is the report-graph migration touching the normalized tables.
  assert.match(ddl, /claims|citations|perspective_links/i, '004 should touch the normalized tables');
  assertNeutral('004_report_graph.sql', ddl);

  // A column-level guard: no ADD COLUMN names a creator/author/channel reliability column.
  const addColumns = [...ddl.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map(
    (m) => m[1] ?? '',
  );
  for (const col of addColumns) {
    assert.doesNotMatch(
      col,
      /creator|author|channel|reliab|credib|verdict|truth/i,
      `migration 004 adds a forbidden creator-reliability column: "${col}"`,
    );
  }
});
