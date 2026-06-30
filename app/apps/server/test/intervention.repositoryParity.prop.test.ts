// Feature: intervention-and-scale, Property 22: Repository drivers agree, and offline operations are safe
// Validates: Requirements 14.2, 14.6
//
// Two legs, both in this one file, both registered under `test:integration`:
//
//  A) OFFLINE-SAFETY (always runs, no database). For a fresh InMemoryRepository
//     with zero keys / zero config / zero reports, every new key / rate / trust /
//     metric / report-graph READ returns its empty/default value, none throws,
//     and no error-level log is emitted (Req 14.6). This is the offline-first
//     path the whole feature must keep working.
//
//  B) DRIVER PARITY (runs only when a database is available). For identical
//     seeded data, the InMemoryRepository (the model) and the PostgresRepository
//     return equivalent observable results — same field values, same array sort
//     order — for the Report_Graph read operations and the key/trust offline
//     reads (Req 14.2). Without TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly
//     (node:test skip), exactly like savedReports.parity / workspace.parity, so
//     the offline suite stays green with zero API keys / no database.
//
// Parity comparison is collation- and storage-aware, deterministically:
//   • queryClaims orders by (reportId ASC, ordinal ASC) — reportId is an ASCII
//     UUID and ordinal is an integer, so the ordered sequence is comparable
//     across drivers without locale risk. We assert it ordered.
//   • Citations / perspectives are copied VERBATIM by the projection, so we
//     compare them as id-agnostic multisets (matched element-by-element),
//     neutralizing the PG-vs-JS free-text ORDER BY collation difference the two
//     drivers legitimately have.
//   • NUMERIC(3,2) columns (claim confidence, perspective divergence /
//     dehumanization) round to two decimals in Postgres but keep full float
//     precision in memory, so numeric fields are compared within a 0.01
//     tolerance, never by exact deep-equal.
//   • aggregateByDomain extracts a host from each citation URL via two different
//     mechanisms (URL().hostname vs a SQL substring), so the seeded URLs are
//     rewritten to clean, port-less, lowercase hosts before seeding BOTH drivers
//     — both extractors then agree and we test the AGGREGATION (counts / ratio)
//     parity, which is the meaningful part.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

import fc from 'fast-check';
import type { Pool } from 'pg';

import { InMemoryRepository } from '../src/infra/memory';
import { PostgresRepository, makePgPool } from '../src/infra/postgres';
import type { ClaimFilter, RateLimitConfig } from '../src/infra/ports';
import type { AnalysisReport, ClaimRow, CitationRow, PerspectiveRow } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

// JSON round-trip: drops keys whose value is `undefined`, so the projection's
// "omit absent optional field" shape compares equal to the Postgres driver's
// "set the key to undefined" shape under deep-equal.
function jnorm<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const FLOAT_TOL = 0.01 + 1e-9; // NUMERIC(3,2) two-decimal rounding tolerance.

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOAT_TOL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg A — offline safety (ALWAYS runs)
// ─────────────────────────────────────────────────────────────────────────────

// A read op against a fresh, empty InMemoryRepository. Every variant must return
// its empty/default value without throwing.
type OfflineOp =
  | { t: 'findApiKey'; hash: string }
  | { t: 'countKeys'; institutionId: string }
  | { t: 'trustConfig'; capability: string }
  | { t: 'evidenceOutcomes' }
  | { t: 'humanSignals' }
  | { t: 'queryClaims'; filter: ClaimFilter }
  | { t: 'citations'; claimUid: string }
  | { t: 'perspectives'; reportId: string }
  | { t: 'aggDomain' }
  | { t: 'aggTopic' };

const anyStr = fc.string();
const claimFilterArb: fc.Arbitrary<ClaimFilter> = fc.record(
  {
    reportId: fc.option(anyStr, { nil: undefined }),
    keyword: fc.option(anyStr, { nil: undefined }),
    fromDate: fc.option(anyStr, { nil: undefined }),
    toDate: fc.option(anyStr, { nil: undefined }),
    topic: fc.option(anyStr, { nil: undefined }),
    page: fc.option(fc.integer({ min: -3, max: 5 }), { nil: undefined }),
    pageSize: fc.option(fc.integer({ min: -3, max: 300 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

const offlineOpArb: fc.Arbitrary<OfflineOp> = fc.oneof(
  fc.record({ t: fc.constant('findApiKey' as const), hash: anyStr }),
  fc.record({ t: fc.constant('countKeys' as const), institutionId: anyStr }),
  fc.record({
    t: fc.constant('trustConfig' as const),
    capability: fc.oneof(fc.constantFrom('feed_friction', 'institutional_api', 'coaching'), anyStr),
  }),
  fc.record({ t: fc.constant('evidenceOutcomes' as const) }),
  fc.record({ t: fc.constant('humanSignals' as const) }),
  fc.record({ t: fc.constant('queryClaims' as const), filter: claimFilterArb }),
  fc.record({ t: fc.constant('citations' as const), claimUid: anyStr }),
  fc.record({ t: fc.constant('perspectives' as const), reportId: anyStr }),
  fc.record({ t: fc.constant('aggDomain' as const) }),
  fc.record({ t: fc.constant('aggTopic' as const) }),
);

const offlineOpsArb = fc.array(offlineOpArb, { minLength: 1, maxLength: 20 });

// Feature: intervention-and-scale, Property 22: offline key/rate/trust/metric/graph reads are safe
// Validates: Requirements 14.2, 14.6
test('Property 22: offline key/rate/trust/metric/graph reads return defaults without throwing or error logs', async () => {
  // Spy on console.error for the whole run: an offline read must emit no
  // error-level log output (Req 14.6).
  const realError = console.error;
  const errorLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };

  try {
    await fc.assert(
      fc.asyncProperty(offlineOpsArb, async (ops) => {
        // Fresh repo per run: zero keys, zero config, zero reports.
        const repo = new InMemoryRepository();
        for (const op of ops) {
          switch (op.t) {
            case 'findApiKey':
              assert.equal(await repo.findApiKeyByHash(op.hash), undefined);
              break;
            case 'countKeys':
              assert.equal(await repo.countActiveApiKeys(op.institutionId), 0);
              break;
            case 'trustConfig':
              assert.equal(await repo.getTrustGateConfig(op.capability), undefined);
              break;
            case 'evidenceOutcomes':
              assert.deepEqual(await repo.listEvidenceOutcomes(), []);
              break;
            case 'humanSignals':
              assert.deepEqual(await repo.listHumanSignals(), []);
              break;
            case 'queryClaims':
              assert.deepEqual(await repo.queryClaims(op.filter), { items: [], totalCount: 0 });
              break;
            case 'citations':
              assert.deepEqual(await repo.listCitationsForClaim(op.claimUid), []);
              break;
            case 'perspectives':
              assert.deepEqual(await repo.listPerspectivesForReport(op.reportId), []);
              break;
            case 'aggDomain':
              assert.deepEqual(await repo.aggregateByDomain(), []);
              break;
            case 'aggTopic':
              assert.deepEqual(await repo.aggregateByTopic(), []);
              break;
          }
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    console.error = realError;
  }

  // No offline read emitted an error-level log (Req 14.6).
  assert.equal(
    errorLogs.length,
    0,
    `offline reads emitted ${errorLogs.length} error log(s): ${JSON.stringify(errorLogs).slice(0, 500)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Leg B — in-memory vs Postgres driver parity (DB-gated)
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = DB_URL
  ? false
  : 'no TEST_DATABASE_URL/DATABASE_URL — skipping Postgres integration test';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// Apply every db/migrations/*.sql in lexical order (001..008), tolerating the
// "already exists" errors a reused test DB raises — mirrors scripts/migrate.mjs.
async function applyMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
    }
  }
}

const REPORT_POOL = 4;

// Clean, port-less, lowercase hosts so URL().hostname (in-memory) and the SQL
// substring (Postgres) extract the SAME domain — letting aggregateByDomain test
// the aggregation logic instead of the URL-parsing edge. A handful of shared
// domains across reports/claims gives the grouping something to group.
const DOMAINS = ['alpha.example.com', 'beta.example.com', 'gamma.example.org'];

function cleanReportUrls(report: AnalysisReport): AnalysisReport {
  let n = 0;
  return {
    ...report,
    claims: report.claims.map((c) => ({
      ...c,
      citations: c.citations.map((cit) => {
        const url = `https://${DOMAINS[n % DOMAINS.length]}/p${n}`;
        n += 1;
        return { ...cit, sourceUrl: url };
      }),
    })),
  };
}

// Compare two arrays as id-agnostic multisets under a custom equality, so a
// PG-vs-JS free-text ordering difference (or NUMERIC rounding) never fails a
// genuine content match. Greedy match each `a` element to an unused `b`.
function assertSameMultiset<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean, msg: string): void {
  assert.equal(a.length, b.length, `${msg} (length)`);
  const used = new Array<boolean>(b.length).fill(false);
  for (const x of a) {
    const j = b.findIndex((y, i) => !used[i] && eq(x, y));
    assert.notEqual(j, -1, `${msg} (no match for ${JSON.stringify(jnorm(x)).slice(0, 200)})`);
    used[j] = true;
  }
}

// Citation equality: every field is copied verbatim by the projection, so an
// exact deep-equal of the JSON-normalized rows is correct.
function citationEq(x: CitationRow, y: CitationRow): boolean {
  try {
    assert.deepEqual(jnorm(x), jnorm(y));
    return true;
  } catch {
    return false;
  }
}

// Perspective equality: text fields verbatim, the two scores within tolerance.
function perspectiveEq(x: PerspectiveRow, y: PerspectiveRow): boolean {
  const { divergence: dx, dehumanization: hx, ...restX } = x;
  const { divergence: dy, dehumanization: hy, ...restY } = y;
  try {
    assert.deepEqual(jnorm(restX), jnorm(restY));
  } catch {
    return false;
  }
  return approxEq(dx, dy) && approxEq(hx, hy);
}

// ClaimRow comparison for the ordered queryClaims result: structural deep-equal
// on every field except confidence, then confidence within tolerance.
function assertClaimRowEq(x: ClaimRow, y: ClaimRow, msg: string): void {
  const { confidence: cx, ...restX } = x;
  const { confidence: cy, ...restY } = y;
  assert.deepEqual(jnorm(restX), jnorm(restY), `${msg} (claim fields)`);
  assert.ok(approxEq(cx, cy), `${msg} (confidence ${cx} vs ${cy})`);
}

// Generated queryClaims filter drawn from the seeded pools (plus some misses).
function pgFilterArb(reportIds: string[], labels: string[]): fc.Arbitrary<ClaimFilter> {
  const reportIdArb = fc.option(fc.oneof(fc.constantFrom(...reportIds), fc.uuid()), { nil: undefined });
  const topicArb =
    labels.length > 0
      ? fc.option(fc.oneof(fc.constantFrom(...labels), fc.string()), { nil: undefined })
      : fc.option(fc.string(), { nil: undefined });
  return fc.record(
    {
      reportId: reportIdArb,
      topic: topicArb,
      page: fc.option(fc.nat({ max: 3 }), { nil: undefined }),
      pageSize: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
    },
    { requiredKeys: [] },
  );
}

// Feature: intervention-and-scale, Property 22: in-memory and Postgres drivers agree on report-graph + key/trust reads
// Validates: Requirements 14.2, 14.6
test('Property 22: in-memory and Postgres repositories agree on report-graph and key/trust reads', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const pg = new PostgresRepository(pool);
  const mem = new InMemoryRepository();

  // One content row + a fixed pool of gate-valid reports, ids/contentId pinned so
  // both drivers persist the SAME logical reports. URLs cleaned for domain parity.
  const contentId = randomUUID();
  const reportIds = Array.from({ length: REPORT_POOL }, () => randomUUID());
  const sampled = fc.sample(gateValidReportArbitrary, REPORT_POOL);
  const reports = sampled.map((r, i) => cleanReportUrls({ ...r, id: reportIds[i]!, contentId }));
  const now = new Date().toISOString();

  try {
    await applyMigrations(pool);

    await pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contentId, `repoparity-${contentId}`, 'youtube', 'https://youtu.be/seed', 'Seed', JSON.stringify({}), now],
    );

    // Seed BOTH drivers with the identical report set (saveReport dual-writes the
    // normalized claim/citation/perspective rows).
    for (const report of reports) {
      await pg.saveReport(report);
      await mem.saveReport(report);
    }

    // Enumerate the seeded claim uids / report ids / topic labels from the model.
    const allClaims = (await mem.queryClaims({ pageSize: 200 })).items;
    const claimUids = [...new Set(allClaims.map((c) => c.claimUid))];
    const labels = [...new Set(reports.flatMap((r) => r.perspectives.map((p) => p.issueFrameLabel)))];

    // ── One-shot deterministic parity over the seeded graph ──

    // Citations per claim: id-agnostic multiset, verbatim fields (Req 14.2).
    for (const claimUid of claimUids) {
      const memCit = await mem.listCitationsForClaim(claimUid);
      const pgCit = await pg.listCitationsForClaim(claimUid);
      assertSameMultiset(pgCit, memCit, citationEq, `citations disagree for claim ${claimUid}`);
    }

    // Perspectives per report: multiset, text verbatim + scores within tolerance.
    for (const reportId of reportIds) {
      const memP = await mem.listPerspectivesForReport(reportId);
      const pgP = await pg.listPerspectivesForReport(reportId);
      assertSameMultiset(pgP, memP, perspectiveEq, `perspectives disagree for report ${reportId}`);
    }

    // Cross-report aggregates: id-agnostic multisets (Req 14.2, 9.4).
    {
      const memD = await mem.aggregateByDomain();
      const pgD = await pg.aggregateByDomain();
      assertSameMultiset(
        pgD,
        memD,
        (x, y) =>
          x.domain === y.domain &&
          x.reportCount === y.reportCount &&
          x.claimCount === y.claimCount &&
          approxEq(x.meanCitedClaimRatio, y.meanCitedClaimRatio),
        'aggregateByDomain disagrees',
      );

      const memT = await mem.aggregateByTopic();
      const pgT = await pg.aggregateByTopic();
      assertSameMultiset(
        pgT,
        memT,
        (x, y) => x.issueFrameLabel === y.issueFrameLabel && x.reportCount === y.reportCount,
        'aggregateByTopic disagrees',
      );
    }

    // ── Key / trust offline-read parity (both empty by construction) ──
    {
      const missHash = createHash('sha256').update(randomUUID()).digest('hex');
      assert.equal(await pg.findApiKeyByHash(missHash), await mem.findApiKeyByHash(missHash));
      const unknownInst = `repoparity-inst-${randomUUID()}`;
      assert.equal(await pg.countActiveApiKeys(unknownInst), await mem.countActiveApiKeys(unknownInst));
      for (const cap of ['feed_friction', 'institutional_api', 'coaching']) {
        assert.equal(await pg.getTrustGateConfig(cap), await mem.getTrustGateConfig(cap));
      }
    }

    // ── Key management round-trip parity: create → hash-lookup on the same driver
    //    yields the same observable shape (institutionId, no rate config) and the
    //    same active count. Plaintext/keyId are random per driver, so never compared.
    {
      const institutionId = `repoparity-inst-${randomUUID()}`;
      const pgKey = await pg.createApiKey(institutionId);
      const memKey = await mem.createApiKey(institutionId);
      const pgFound = await pg.findApiKeyByHash(createHash('sha256').update(pgKey.plaintext).digest('hex'));
      const memFound = await mem.findApiKeyByHash(createHash('sha256').update(memKey.plaintext).digest('hex'));
      assert.ok(pgFound && memFound, 'a freshly created key must resolve by its hash in both drivers');
      assert.equal(pgFound!.institutionId, institutionId);
      assert.equal(memFound!.institutionId, institutionId);
      assert.equal(pgFound!.rateLimit, undefined);
      assert.equal(memFound!.rateLimit, undefined);
      assert.equal(await pg.countActiveApiKeys(institutionId), await mem.countActiveApiKeys(institutionId));

      // Revoke parity: after revoking, the hash no longer resolves and the count
      // drops to zero in both drivers (Req 6.4, 14.2).
      await pg.revokeApiKey(pgKey.keyId);
      await mem.revokeApiKey(memKey.keyId);
      assert.equal(
        await pg.findApiKeyByHash(createHash('sha256').update(pgKey.plaintext).digest('hex')),
        undefined,
      );
      assert.equal(
        await mem.findApiKeyByHash(createHash('sha256').update(memKey.plaintext).digest('hex')),
        undefined,
      );
      assert.equal(await pg.countActiveApiKeys(institutionId), await mem.countActiveApiKeys(institutionId));
    }

    // ── Per-key rate-window parity: a deterministic burst within one window agrees
    //    on allowed / remaining / limit (resetSeconds is wall-clock and excluded).
    {
      const inst = `repoparity-inst-${randomUUID()}`;
      const pgKey = await pg.createApiKey(inst);
      const memKey = await mem.createApiKey(inst);
      const cfg: RateLimitConfig = { maxRequests: 3, windowSeconds: 3600 };
      for (let i = 0; i < 5; i++) {
        const p = await pg.institutionalHit(pgKey.keyId, cfg);
        const m = await mem.institutionalHit(memKey.keyId, cfg);
        assert.equal(p.allowed, m.allowed, `rate allowed disagrees at hit ${i}`);
        assert.equal(p.remaining, m.remaining, `rate remaining disagrees at hit ${i}`);
        assert.equal(p.limit, m.limit, `rate limit disagrees at hit ${i}`);
      }
    }

    // ── 100-run property: queryClaims filtering + pagination parity, ORDERED ──
    await fc.assert(
      fc.asyncProperty(pgFilterArb(reportIds, labels), async (filter) => {
        const m = await mem.queryClaims(filter);
        const p = await pg.queryClaims(filter);
        assert.equal(p.totalCount, m.totalCount, 'queryClaims totalCount disagrees');
        assert.equal(p.items.length, m.items.length, 'queryClaims page length disagrees');
        // Ordered comparison: order key (reportId, ordinal) is collation-safe.
        for (let i = 0; i < m.items.length; i++) {
          assertClaimRowEq(p.items[i]!, m.items[i]!, `queryClaims item ${i} disagrees`);
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    // content_items delete cascades to analysis_reports → claims/citations/
    // perspective_links. API keys are institution-scoped run-unique ids; the
    // api_keys rows linger harmlessly (no FK to the dropped content).
    await pool.query('DELETE FROM content_items WHERE id = $1', [contentId]).catch(() => {});
    await pool.end();
  }
});
