// Feature: intervention-and-scale, Property 15: GraphQL claim queries respect filters, pagination, and metadata
// Feature: intervention-and-scale, Property 16: GraphQL citation and perspective results carry their required fields
// Feature: intervention-and-scale, Property 17: GraphQL aggregates equal a direct recomputation
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 9.3

// These run REAL GraphQL execution via graphql-js (`graphql({ schema, source,
// rootValue, variableValues })`) over the read-only root value from
// graphql/resolvers, backed by an InMemoryRepository seeded with gate-valid
// reports. No mocks: saveReport dual-writes the normalized claim/citation/
// perspective rows the resolvers read, so the query path is exercised end to end.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';
import { graphql } from 'graphql';

import { schema } from '../src/graphql/schema';
import { makeRootValue } from '../src/graphql/resolvers';
import { InMemoryRepository } from '../src/infra/memory';
import type { AnalysisReport } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

// A corpus of 1..5 gate-valid reports with report ids, share slugs, and claim ids
// made unique across the corpus (saveReport keys on report.id; cross-report claim
// id collisions would blur the per-claimUid citation lookup).
const corpusArb: fc.Arbitrary<AnalysisReport[]> = fc
  .array(gateValidReportArbitrary, { minLength: 1, maxLength: 5 })
  .map((reports) =>
    reports.map((r, i) => ({
      ...r,
      id: `report-${i}-${r.id}`,
      shareSlug: `slug-${i}-${r.shareSlug ?? ''}`,
      claims: r.claims.map((c) => ({ ...c, id: `r${i}-${c.id}` })),
    })),
  );

async function seedRepo(reports: AnalysisReport[]): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  for (const r of reports) await repo.saveReport(r);
  return repo;
}

// Mirror of memory.queryClaims' filtering (reportId/keyword/topic only) so the
// expected match set is computed independently of the resolver under test.
interface ClaimFilterLike {
  reportId?: string;
  keyword?: string;
  topic?: string;
}
function expectedMatches(
  reports: AnalysisReport[],
  filter: ClaimFilterLike,
): Array<{ claimUid: string; reportId: string }> {
  let claims = reports.flatMap((r) =>
    r.claims.map((c) => ({ claimUid: c.id, reportId: r.id, claimText: c.claimText, report: r })),
  );
  if (filter.reportId) claims = claims.filter((c) => c.reportId === filter.reportId);
  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    claims = claims.filter((c) => c.claimText.toLowerCase().includes(kw));
  }
  if (filter.topic) {
    const topic = filter.topic;
    claims = claims.filter((c) => c.report.perspectives.some((p) => p.issueFrameLabel === topic));
  }
  return claims.map((c) => ({ claimUid: c.claimUid, reportId: c.reportId }));
}

const CLAIMS_QUERY = `
  query($reportId: String, $keyword: String, $topic: String, $page: Int, $pageSize: Int) {
    claims(reportId: $reportId, keyword: $keyword, topic: $topic, page: $page, pageSize: $pageSize) {
      items { claimUid reportId claimText evidenceStrength verifiability citationCount }
      totalCount
      pageOffset
      hasNextPage
    }
  }
`;

describe('Property 15: GraphQL claim queries respect filters, pagination, and metadata', () => {
  it('returns only matching claims with consistent totalCount/pageOffset/hasNextPage and clamped pageSize', () => {
    return fc.assert(
      fc.asyncProperty(
        corpusArb,
        fc.record({
          pickReport: fc.boolean(),
          reportSel: fc.nat(),
          pickKeyword: fc.boolean(),
          keywordSel: fc.nat(),
          keywordLen: fc.integer({ min: 1, max: 6 }),
          pickTopic: fc.boolean(),
          topicSel: fc.nat(),
          page: fc.integer({ min: 0, max: 5 }),
          pageSizeRaw: fc.integer({ min: -10, max: 300 }),
        }),
        async (reports, sel) => {
          const repo = await seedRepo(reports);

          // Derive filter values from the seeded corpus so filters actually bite.
          const filter: ClaimFilterLike = {};
          if (sel.pickReport) {
            filter.reportId = reports[sel.reportSel % reports.length]!.id;
          }
          if (sel.pickKeyword) {
            const allClaims = reports.flatMap((r) => r.claims);
            const withText = allClaims.filter((c) => c.claimText.length > 0);
            if (withText.length > 0) {
              const c = withText[sel.keywordSel % withText.length]!;
              const kw = c.claimText.slice(0, sel.keywordLen);
              if (kw.length > 0) filter.keyword = kw;
            }
          }
          if (sel.pickTopic) {
            const labels = reports
              .flatMap((r) => r.perspectives.map((p) => p.issueFrameLabel))
              .filter((l) => l.length > 0);
            if (labels.length > 0) filter.topic = labels[sel.topicSel % labels.length]!;
          }

          const variableValues: Record<string, unknown> = { page: sel.page, pageSize: sel.pageSizeRaw };
          if (filter.reportId !== undefined) variableValues.reportId = filter.reportId;
          if (filter.keyword !== undefined) variableValues.keyword = filter.keyword;
          if (filter.topic !== undefined) variableValues.topic = filter.topic;

          const result = await graphql({
            schema,
            source: CLAIMS_QUERY,
            rootValue: makeRootValue(repo),
            variableValues,
          });

          assert.equal(result.errors, undefined, `GraphQL errors: ${JSON.stringify(result.errors)}`);
          const page = (result.data as { claims: {
            items: Array<{ claimUid: string; reportId: string; claimText: string }>;
            totalCount: number;
            pageOffset: number;
            hasNextPage: boolean;
          } }).claims;

          const matches = expectedMatches(reports, filter);
          const matchSet = new Set(matches.map((m) => m.claimUid));

          // Every returned item matches the filters (Req 7.2, 7.3).
          for (const item of page.items) {
            assert.ok(matchSet.has(item.claimUid), `returned claim ${item.claimUid} does not match filters`);
            if (filter.reportId !== undefined) {
              assert.equal(item.reportId, filter.reportId);
            }
            if (filter.keyword !== undefined) {
              assert.ok(item.claimText.toLowerCase().includes(filter.keyword.toLowerCase()));
            }
          }

          // totalCount equals the independently computed match count (Req 7.9, 7.10).
          assert.equal(page.totalCount, matches.length);

          // pageSize clamp [1,200] default 50; pageOffset = page * effectivePageSize (Req 7.1, 7.10).
          const effPageSize = Math.max(1, Math.min(200, sel.pageSizeRaw));
          assert.ok(page.items.length <= effPageSize, `items.length ${page.items.length} > pageSize ${effPageSize}`);
          assert.equal(page.pageOffset, sel.page * effPageSize);

          // hasNextPage true iff more remain past this page (Req 7.10).
          assert.equal(page.hasNextPage, page.pageOffset + page.items.length < page.totalCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clamps pageSize to default 50 when omitted', () => {
    return fc.assert(
      fc.asyncProperty(corpusArb, async (reports) => {
        const repo = await seedRepo(reports);
        const result = await graphql({
          schema,
          source: `{ claims { items { claimUid } totalCount pageOffset hasNextPage } }`,
          rootValue: makeRootValue(repo),
        });
        assert.equal(result.errors, undefined, `GraphQL errors: ${JSON.stringify(result.errors)}`);
        const page = (result.data as { claims: { items: unknown[]; pageOffset: number } }).claims;
        // Default page 0, default pageSize 50 => offset 0, at most 50 items.
        assert.equal(page.pageOffset, 0);
        assert.ok(page.items.length <= 50);
      }),
      { numRuns: 100 },
    );
  });
});

const CITATIONS_QUERY = `
  query($claimUid: String!) {
    citations(claimUid: $claimUid) {
      sourceUrl sourceName sourceTier excerpt supports claimUid
    }
  }
`;
const PERSPECTIVES_QUERY = `
  query($reportId: String!) {
    perspectiveLinks(reportId: $reportId) {
      reportId issueFrameLabel divergence dehumanization sourceName sourceTier
    }
  }
`;
const VALID_TIERS = new Set(['tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded']);
const VALID_SUPPORTS = new Set(['supports', 'contradicts', 'context']);

describe('Property 16: GraphQL citation and perspective results carry their required fields', () => {
  it('citations(claimUid) carry sourceUrl/sourceName/sourceTier/supports/claimUid (excerpt optional)', () => {
    return fc.assert(
      fc.asyncProperty(corpusArb, fc.nat(), async (reports, claimSel) => {
        const repo = await seedRepo(reports);
        const allClaims = reports.flatMap((r) => r.claims);
        const claim = allClaims[claimSel % allClaims.length]!;

        const result = await graphql({
          schema,
          source: CITATIONS_QUERY,
          rootValue: makeRootValue(repo),
          variableValues: { claimUid: claim.id },
        });
        assert.equal(result.errors, undefined, `GraphQL errors: ${JSON.stringify(result.errors)}`);
        const citations = (result.data as { citations: Array<{
          sourceUrl: string; sourceName: string; sourceTier: string;
          excerpt: string | null; supports: string; claimUid: string;
        }> }).citations;

        for (const c of citations) {
          assert.equal(typeof c.sourceUrl, 'string');
          assert.equal(typeof c.sourceName, 'string');
          assert.ok(VALID_TIERS.has(c.sourceTier), `bad sourceTier "${c.sourceTier}"`);
          assert.ok(VALID_SUPPORTS.has(c.supports), `bad supports label "${c.supports}"`);
          assert.equal(c.claimUid, claim.id);
          // excerpt is optional: either a string or null, never undefined-typed.
          assert.ok(c.excerpt === null || typeof c.excerpt === 'string');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('perspectiveLinks(reportId) carry reportId/issueFrameLabel/divergence/dehumanization/sourceName/sourceTier', () => {
    return fc.assert(
      fc.asyncProperty(corpusArb, fc.nat(), async (reports, reportSel) => {
        const repo = await seedRepo(reports);
        const report = reports[reportSel % reports.length]!;

        const result = await graphql({
          schema,
          source: PERSPECTIVES_QUERY,
          rootValue: makeRootValue(repo),
          variableValues: { reportId: report.id },
        });
        assert.equal(result.errors, undefined, `GraphQL errors: ${JSON.stringify(result.errors)}`);
        const links = (result.data as { perspectiveLinks: Array<{
          reportId: string; issueFrameLabel: string; divergence: number;
          dehumanization: number; sourceName: string; sourceTier: string;
        }> }).perspectiveLinks;

        // One link per seeded perspective on this report.
        assert.equal(links.length, report.perspectives.length);
        for (const l of links) {
          assert.equal(l.reportId, report.id);
          assert.equal(typeof l.issueFrameLabel, 'string');
          assert.equal(typeof l.divergence, 'number');
          assert.ok(Number.isFinite(l.divergence));
          assert.equal(typeof l.dehumanization, 'number');
          assert.ok(Number.isFinite(l.dehumanization));
          assert.equal(typeof l.sourceName, 'string');
          assert.ok(VALID_TIERS.has(l.sourceTier), `bad sourceTier "${l.sourceTier}"`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

const AGGREGATES_QUERY = `
  {
    domainAggregates { domain reportCount claimCount meanCitedClaimRatio }
    sourceDomainFrequency { domain reportCount claimCount meanCitedClaimRatio }
    topicAggregates { issueFrameLabel reportCount }
    topicDistribution { issueFrameLabel reportCount }
  }
`;

describe('Property 17: GraphQL aggregates equal a direct recomputation', () => {
  it('domain/topic aggregates via GraphQL equal direct repository reads', () => {
    return fc.assert(
      fc.asyncProperty(corpusArb, async (reports) => {
        const repo = await seedRepo(reports);

        const result = await graphql({
          schema,
          source: AGGREGATES_QUERY,
          rootValue: makeRootValue(repo),
        });
        assert.equal(result.errors, undefined, `GraphQL errors: ${JSON.stringify(result.errors)}`);
        const data = result.data as {
          domainAggregates: unknown[];
          sourceDomainFrequency: unknown[];
          topicAggregates: unknown[];
          topicDistribution: unknown[];
        };

        const directDomain = await repo.aggregateByDomain();
        const directTopic = await repo.aggregateByTopic();

        // graphql-js execution returns objects with a null prototype; the direct
        // repository reads are plain objects. Values are identical — round-trip
        // both sides through JSON so the structural compare ignores prototypes.
        const norm = (v: unknown) => JSON.parse(JSON.stringify(v));

        // Both domain-keyed fields equal the direct recomputation (Req 7.4, 7.5).
        assert.deepStrictEqual(norm(data.domainAggregates), norm(directDomain));
        assert.deepStrictEqual(norm(data.sourceDomainFrequency), norm(directDomain));
        // Both topic-keyed fields equal the direct recomputation (Req 7.4, 7.5).
        assert.deepStrictEqual(norm(data.topicAggregates), norm(directTopic));
        assert.deepStrictEqual(norm(data.topicDistribution), norm(directTopic));
      }),
      { numRuns: 100 },
    );
  });
});
