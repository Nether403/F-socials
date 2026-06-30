// Read-only GraphQL root value for the Institutional API (intervention-and-scale).
// Resolvers call ONLY existing read-side Report_Graph Repository methods — there is
// no resolver-side SQL and no write path (Req 9.1, 9.2, 9.4). Used with graphql-js
// `buildSchema` + a root value object (see graphql/schema.ts), so each field is a
// function on the returned record. Nested Claim.citations is pre-resolved (awaited)
// when building each claim — simpler and still read-only than a nested resolver.

import type { Repository, ClaimFilter } from '../infra/ports'
import type { CitationRow, ClaimRow } from '../types'

// Citation.supports is boolean | null in the row (true=supports, false=contradicts,
// null=context). The schema exposes it as a non-null String, so map it to a stable
// label here.
function supportsLabel(supports: boolean | null): string {
  return supports === true ? 'supports' : supports === false ? 'contradicts' : 'context'
}

function mapCitation(row: CitationRow) {
  return {
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
    sourceTier: row.sourceTier,
    excerpt: row.excerpt ?? null,
    supports: supportsLabel(row.supports),
    claimUid: row.claimUid,
  }
}

// Pre-resolve a claim's citations (read-only) and expose citationCount, matching the
// GraphQL Claim type's fields.
async function mapClaim(repo: Repository, row: ClaimRow) {
  const citations = (await repo.listCitationsForClaim(row.claimUid)).map(mapCitation)
  return {
    claimUid: row.claimUid,
    reportId: row.reportId,
    claimText: row.claimText,
    evidenceStrength: row.evidenceStrength,
    verifiability: row.verifiability,
    citationCount: citations.length,
    citations,
  }
}

interface ClaimsArgs {
  reportId?: string
  keyword?: string
  fromDate?: string
  toDate?: string
  topic?: string
  page?: number
  pageSize?: number
}

export function makeRootValue(repo: Repository): Record<string, unknown> {
  return {
    async claims(args: ClaimsArgs) {
      // Clamp pageSize to [1, 200] (default 50); page floors at 0 (Req 7.1).
      const pageSize = Math.max(1, Math.min(200, args.pageSize ?? 50))
      const page = Math.max(0, args.page ?? 0)
      const filter: ClaimFilter = {
        reportId: args.reportId,
        keyword: args.keyword,
        fromDate: args.fromDate,
        toDate: args.toDate,
        topic: args.topic,
        page,
        pageSize,
      }
      const { items, totalCount } = await repo.queryClaims(filter)
      const mapped = await Promise.all(items.map((row) => mapClaim(repo, row)))
      const pageOffset = page * pageSize
      return {
        items: mapped,
        totalCount,
        pageOffset,
        hasNextPage: pageOffset + mapped.length < totalCount,
      }
    },

    async citations(args: { claimUid: string }) {
      const rows = await repo.listCitationsForClaim(args.claimUid)
      return rows.map(mapCitation)
    },

    async perspectiveLinks(args: { reportId: string }) {
      const rows = await repo.listPerspectivesForReport(args.reportId)
      return rows.map((p) => ({
        reportId: p.reportId,
        issueFrameLabel: p.issueFrameLabel,
        divergence: p.divergence,
        dehumanization: p.dehumanization,
        sourceName: p.sourceName,
        sourceTier: p.sourceTier,
      }))
    },

    // Frequency = totalCount of the matching claims under the given filters (Req 7.4).
    async claimFrequency(args: { keyword?: string; topic?: string }) {
      const { totalCount } = await repo.queryClaims({ keyword: args.keyword, topic: args.topic })
      return totalCount
    },

    sourceDomainFrequency() {
      return repo.aggregateByDomain()
    },

    topicDistribution() {
      return repo.aggregateByTopic()
    },

    domainAggregates() {
      return repo.aggregateByDomain()
    },

    topicAggregates() {
      return repo.aggregateByTopic()
    },
  }
}
