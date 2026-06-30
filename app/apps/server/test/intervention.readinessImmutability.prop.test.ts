// Feature: intervention-and-scale, Property 21: Serving leaves readiness and the persisted report unchanged
// Validates: Requirements 9.2, 13.2, 13.3, 13.5
//
// The three serving surfaces of this feature are read-mostly by construction:
// the friction overlay is a pure projection of an already-`ready` report, and
// the GraphQL resolvers call only read-side Repository methods over the
// Report_Graph. This suite pins that invariant: persisting a gate-valid report,
// snapshotting it, then exercising the friction projection AND every GraphQL
// read resolver must leave both the report's `status` and the persisted rows
// (analysis_reports JSONB + Report_Graph claim/citation/perspective rows)
// byte-for-byte identical. A static check additionally proves no serving module
// imports `assembleReport` — readiness can never be recomputed on a read path.

import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { projectFrictionOverlay } from '../src/core/frictionOverlay';
import { makeRootValue } from '../src/graphql/resolvers';
import { gateValidReportArbitrary } from './reportGraph.arb';

// Concrete shape of the GraphQL root value's read resolvers used here. Asserting
// the specific methods as required functions (rather than an index signature)
// keeps each call non-optional under `noUncheckedIndexedAccess`.
type RootResolvers = Record<
  | 'claims'
  | 'citations'
  | 'perspectiveLinks'
  | 'claimFrequency'
  | 'sourceDomainFrequency'
  | 'topicDistribution'
  | 'domainAggregates'
  | 'topicAggregates',
  (args: unknown) => unknown
>;

const BASE_URL = 'https://app.f-socials.example';
const HERE = dirname(fileURLToPath(import.meta.url));

// Snapshot every persisted artifact a serving path could observe for a report:
// the JSONB report row, plus its normalized Report_Graph rows. Deep-cloned so a
// later mutation can't retroactively change the snapshot.
async function snapshotPersistence(repo: InMemoryRepository, reportId: string) {
  const report = await repo.getReport(reportId);
  return {
    report: structuredClone(report),
    claimRows: structuredClone(repo.claimRows.get(reportId)),
    citationRows: structuredClone(repo.citationRows.get(reportId)),
    perspectiveRows: structuredClone(repo.perspectiveRows.get(reportId)),
  };
}

// Exercise the full read surface: the friction projection + every GraphQL read
// resolver, including the nested Claim.citations resolution.
async function serveEverything(repo: InMemoryRepository, reportId: string) {
  const report = await repo.getReport(reportId);
  assert.ok(report, 'report must be persisted before serving');

  // 1. Friction overlay projection (read-only pure projection).
  projectFrictionOverlay(report, BASE_URL);

  // 2. GraphQL read resolvers — call each one the schema exposes.
  const root = makeRootValue(repo) as unknown as RootResolvers;
  const claimPage = (await root.claims({ reportId })) as { items: Array<{ claimUid: string }> };
  // Drill into a real claimUid so the citations resolver does real work.
  const someClaimUid = repo.claimRows.get(reportId)?.[0]?.claimUid;
  if (someClaimUid) await root.citations({ claimUid: someClaimUid });
  await root.perspectiveLinks({ reportId });
  await root.claimFrequency({});
  await root.sourceDomainFrequency({});
  await root.topicDistribution({});
  await root.domainAggregates({});
  await root.topicAggregates({});

  return claimPage;
}

describe('Property 21: Serving leaves readiness and the persisted report unchanged', () => {
  it('serving never changes the report status (no read path recomputes readiness)', () => {
    fc.assert(
      fc.asyncProperty(gateValidReportArbitrary, async (report) => {
        const repo = new InMemoryRepository();
        await repo.saveReport(report);

        const before = (await repo.getReport(report.id))!.status;
        assert.equal(before, 'ready', 'precondition: gate-valid report is ready');

        await serveEverything(repo, report.id);

        const after = (await repo.getReport(report.id))!.status;
        // The status consumed equals the stored status — serving reads it, never
        // recomputes it (Req 13.2).
        assert.equal(after, before, 'serving must not change the report status');
      }),
      { numRuns: 100 },
    );
  });

  it('serving leaves the persisted report row and Report_Graph rows identical', () => {
    fc.assert(
      fc.asyncProperty(gateValidReportArbitrary, async (report) => {
        const repo = new InMemoryRepository();
        await repo.saveReport(report);

        const before = await snapshotPersistence(repo, report.id);
        await serveEverything(repo, report.id);
        const after = await snapshotPersistence(repo, report.id);

        // The analysis_reports JSONB + every Report_Graph row is byte-for-byte
        // identical before and after serving (Req 13.3, 9.2).
        assert.deepEqual(after.report, before.report, 'report row must be unchanged');
        assert.deepEqual(after.claimRows, before.claimRows, 'claim rows must be unchanged');
        assert.deepEqual(after.citationRows, before.citationRows, 'citation rows must be unchanged');
        assert.deepEqual(after.perspectiveRows, before.perspectiveRows, 'perspective rows must be unchanged');
      }),
      { numRuns: 100 },
    );
  });

  it('GraphQL read paths never write Report_Graph rows', () => {
    fc.assert(
      fc.asyncProperty(gateValidReportArbitrary, async (report) => {
        const repo = new InMemoryRepository();
        await repo.saveReport(report);

        // Row-count fingerprint of the entire graph store across ALL reports.
        const fingerprint = () => ({
          reports: [...repo.claimRows.keys()].sort(),
          claims: [...repo.claimRows.entries()].map(([k, v]) => [k, v.length] as const),
          citations: [...repo.citationRows.entries()].map(([k, v]) => [k, v.length] as const),
          perspectives: [...repo.perspectiveRows.entries()].map(([k, v]) => [k, v.length] as const),
        });

        const before = fingerprint();

        // Run only the GraphQL resolvers (no projection) many ways.
        const root = makeRootValue(repo) as unknown as RootResolvers;
        await root.claims({});
        await root.claims({ reportId: report.id });
        const uid = repo.claimRows.get(report.id)?.[0]?.claimUid;
        if (uid) await root.citations({ claimUid: uid });
        await root.perspectiveLinks({ reportId: report.id });
        await root.claimFrequency({ keyword: 'x' });
        await root.sourceDomainFrequency({});
        await root.topicDistribution({});
        await root.domainAggregates({});
        await root.topicAggregates({});

        const after = fingerprint();
        // No new report keys, no row added or removed anywhere — resolvers read only.
        assert.deepEqual(after, before, 'GraphQL reads must not write any Report_Graph rows');
      }),
      { numRuns: 100 },
    );
  });

  it('static guarantee: no serving module imports or invokes assembleReport', () => {
    // The moat is satisfied by construction: no serving path can promote,
    // demote, or recompute readiness because none of them call assembleReport
    // (Req 13.5). Verified by source inspection of both serving modules.
    const servingModules = [
      resolve(HERE, '../src/core/frictionOverlay.ts'),
      resolve(HERE, '../src/graphql/resolvers.ts'),
    ];

    for (const modulePath of servingModules) {
      const source = readFileSync(modulePath, 'utf8');

      // No import from any `assemble` module.
      const assembleImport = /import[\s\S]*?from\s+['"][^'"]*assemble['"]/;
      assert.equal(
        assembleImport.test(source),
        false,
        `${modulePath} must not import from an assemble module`,
      );

      // No reference to assembleReport anywhere in the module.
      assert.equal(
        source.includes('assembleReport'),
        false,
        `${modulePath} must not reference assembleReport`,
      );
    }
  });
});
