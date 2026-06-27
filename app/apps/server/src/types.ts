// Domain types. Union types (not TS enums) so Node can run these files natively
// and so they map 1:1 to the Postgres enums in db/migrations/001_init.sql.

export type SourceType = 'youtube' | 'article' | 'transcript';
export type ReportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'needs_review';
export type ProducingLayer = 'ai' | 'expert' | 'community';
export type Verifiability = 'verifiable' | 'partially_verifiable' | 'opinion' | 'unverifiable';
export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'none';
export type SourceTier = 'tier1_primary' | 'tier2_institutional' | 'tier3_viewpoint' | 'excluded';

export interface Citation {
  sourceUrl: string;
  sourceName: string;
  sourceTier: SourceTier;
  excerpt?: string;
  supports: boolean | null; // true=supports, false=contradicts, null=context
}

export interface Claim {
  id: string;
  claimText: string;
  transcriptSpan?: string;
  verifiability: Verifiability;
  evidenceStrength: EvidenceStrength;
  sourceBasis?: string;
  evidenceDescription?: string; // optional human-readable evidence review
  confidence: number;
  citations: Citation[];
}

// A framing signal is about *how* something is said (rhetoric). Its evidence is the
// quote(s) that triggered it. Each example carries char offsets into the transcript
// so the UI can highlight the span (offsets computed server-side via indexOf, not
// trusted from the LLM). Factual omissions live in contextCards, not here.
export interface FramingExample {
  text: string; // verbatim quote from the transcript
  explanation: string; // why this span is a framing signal
  startIndex: number; // offset in transcript (-1 if not located)
  endIndex: number;
}

export interface FramingSignal {
  technique: string; // e.g. "Emotional Language", "Us vs. Them Framing"
  severity: 'low' | 'medium' | 'high';
  description: string; // overall description of the technique's use
  examples: FramingExample[]; // >=1 required
}

// Structured "useful context" the content omits. Title + description are required;
// a source is optional (the LLM identifies the gap; it must not fabricate sources).
export interface ContextCard {
  title: string;
  description: string;
  sourceName?: string;
  sourceUrl?: string;
}

export interface PerspectiveLink {
  url: string;
  sourceName: string;
  sourceTier: SourceTier;
  issueFrameLabel: string;
  divergence: number;
  dehumanization: number;
  whyIncluded?: string;
}

export interface IssueFrame {
  label: string;
  x: number;
  y: number;
}

// Report footer transparency — which layer/model produced or last touched this.
export interface Provenance {
  model: string; // e.g. "gemini-3.1-flash-lite" or "mock"
  analysisVersion: string;
  sourcePolicyVersion: string;
  reviewStatus: 'ai-generated' | 'expert-reviewed' | 'under-dispute';
  lastUpdated: string; // ISO
  disputesCount: number;
}

export interface RawInput {
  sourceType: SourceType;
  url?: string;
  transcript?: string;
}

export interface ContentItem {
  id: string;
  urlHash: string;
  sourceType: SourceType;
  sourceUrl?: string;
  title?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AnalysisReport {
  id: string;
  contentId: string;
  urlHash: string;
  status: ReportStatus;
  version: number;
  producingLayer: ProducingLayer;
  title?: string; // source title (video/article), from the transcript provider
  tldr?: string;
  issueFrame?: IssueFrame;
  transcript?: string; // source text, for interactive highlighting in the UI
  claims: Claim[];
  framingSignals: FramingSignal[];
  contextCards: ContextCard[];
  perspectives: PerspectiveLink[];
  provenance?: Provenance;
  confidence?: number;
  shareSlug?: string;
  reasons?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Normalized row types (report-graph-normalization). These mirror the
// claims/citations/perspective_links DB columns 1:1 (camelCase in TS,
// snake_case in SQL), reusing Verifiability, EvidenceStrength, and SourceTier
// above — no parallel vocabularies. Lens, not judge: source tiers attach only
// to citations and perspectives; no creator-reliability dimension exists here.

export interface ClaimRow {
  claimUid: string; // originating Claim.id — stable traceback to the JSONB payload
  reportId: string; // owning report
  claimText: string;
  transcriptSpan?: string;
  verifiability: Verifiability;
  evidenceStrength: EvidenceStrength;
  sourceBasis?: string;
  confidence: number;
  ordinal: number; // render order within the report
}

export interface CitationRow {
  claimUid: string; // links to the ClaimRow it belongs to
  sourceUrl: string;
  sourceName: string;
  sourceTier: SourceTier; // carried from the Citation; sources only
  excerpt?: string;
  supports: boolean | null;
}

export interface PerspectiveRow {
  reportId: string;
  url: string;
  sourceName: string;
  sourceTier: SourceTier; // sources only
  issueFrameLabel: string;
  divergence: number; // -> divergence_score
  dehumanization: number; // -> dehumanization_score
}

// ──────────────────────────────────────────────────────────────────────────
// Claim_Verification_Router types. Union types (not TS enums) to match the rest
// of this file. The router owns these; it reuses Citation, EvidenceStrength, and
// SourceTier above rather than introducing parallel vocabularies.

export type ClaimType =
  | 'factual_event'
  | 'statistical'
  | 'causal'
  | 'quote_paraphrase'
  | 'prediction'
  | 'normative_opinion'
  | 'implied_rhetorical';

export type FactCheckability = 'checkable' | 'not_fact_checkable';

export type QueryVariantKind =
  | 'exact_normalized'
  | 'compressed_entity_predicate'
  | 'fact_check_style'
  | 'counterclaim_negated'
  | 'source_language'
  | 'english';

export type MatchType =
  | 'same_claim'
  | 'same_topic_different_claim'
  | 'background_context'
  | 'contradictory_but_relevant'
  | 'irrelevant';

export type EvidenceOutcome =
  | 'matched_fact_check'
  | 'matched_primary_source'
  | 'matched_institutional_source'
  | 'relevant_context_only'
  | 'no_sufficient_evidence'
  | 'not_fact_checkable';

export type PrototypeVocab = 'supported' | 'mixed' | 'weak' | 'insufficient';

export interface QueryVariant {
  text: string;
  kind: QueryVariantKind;
}

export interface Candidate {
  sourceUrl: string;
  sourceName: string;
  excerpt?: string;
  sourceTier: SourceTier; // from classifyCitationTier
  isFactCheck: boolean; // provider origin = Google Fact Check
  fromVariant: QueryVariantKind; // which query surfaced it
  retrievalRank: number; // 0-based rank within that variant's results
}

export interface ValidatedCandidate {
  candidate: Candidate;
  matchType: MatchType;
  matchConfidence: number; // 0..1 inclusive
  selectedAsEvidence: boolean; // entered the Claim_Ledger
}

export interface AuditRecord {
  claimId: string;
  originalClaim: string;
  canonicalClaim: string;
  claimType: ClaimType;
  factCheckability: FactCheckability;
  queryPack: QueryVariant[]; // empty when not_fact_checkable
  candidates: ValidatedCandidate[]; // empty when not_fact_checkable
  evidenceOutcome: EvidenceOutcome;
  evidenceStrength: EvidenceStrength;
  prototypeVocab: PrototypeVocab;
  createdAt: string; // ISO
}
