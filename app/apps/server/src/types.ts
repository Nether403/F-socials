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
