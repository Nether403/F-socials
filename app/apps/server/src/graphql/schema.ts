import { buildSchema } from 'graphql'

export const schema = buildSchema(`
  type Citation {
    sourceUrl: String!
    sourceName: String!
    sourceTier: String!
    excerpt: String
    supports: String!
    claimUid: String!
  }

  type Claim {
    claimUid: String!
    reportId: String!
    claimText: String!
    evidenceStrength: String!
    citationCount: Int!
    verifiability: String!
    citations: [Citation!]!
  }

  type PerspectiveLink {
    reportId: String!
    issueFrameLabel: String!
    divergence: Float!
    dehumanization: Float!
    sourceName: String!
    sourceTier: String!
  }

  type ClaimPage {
    items: [Claim!]!
    totalCount: Int!
    pageOffset: Int!
    hasNextPage: Boolean!
  }

  type DomainAggregate {
    domain: String!
    reportCount: Int!
    claimCount: Int!
    meanCitedClaimRatio: Float!
  }

  type TopicAggregate {
    issueFrameLabel: String!
    reportCount: Int!
  }

  type Query {
    claims(reportId: String, keyword: String, fromDate: String, toDate: String, topic: String, page: Int = 0, pageSize: Int = 50): ClaimPage!
    citations(claimUid: String!): [Citation!]!
    perspectiveLinks(reportId: String!): [PerspectiveLink!]!
    claimFrequency(keyword: String, topic: String): Int!
    sourceDomainFrequency: [DomainAggregate!]!
    topicDistribution: [TopicAggregate!]!
    domainAggregates: [DomainAggregate!]!
    topicAggregates: [TopicAggregate!]!
  }
`)
