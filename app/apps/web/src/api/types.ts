// Mirrors the backend report contract (apps/server/src/types.ts).

export type SourceType = 'youtube' | 'article' | 'transcript';
export type ReportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'needs_review';
export type Verifiability = 'verifiable' | 'partially_verifiable' | 'opinion' | 'unverifiable';
export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'none';
export type SourceTier = 'tier1_primary' | 'tier2_institutional' | 'tier3_viewpoint' | 'excluded';

export interface Citation {
  sourceUrl: string;
  sourceName: string;
  sourceTier: SourceTier;
  excerpt?: string;
  supports: boolean | null;
}

export interface Claim {
  id: string;
  claimText: string;
  transcriptSpan?: string;
  verifiability: Verifiability;
  evidenceStrength: EvidenceStrength;
  sourceBasis?: string;
  evidenceDescription?: string;
  confidence: number;
  citations: Citation[];
}

export interface FramingExample {
  text: string;
  explanation: string;
  startIndex: number;
  endIndex: number;
}

export interface FramingSignal {
  technique: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  examples: FramingExample[];
}

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

export interface Provenance {
  model: string;
  analysisVersion: string;
  sourcePolicyVersion: string;
  reviewStatus: string;
  lastUpdated: string;
  disputesCount: number;
}

export interface AnalysisReport {
  id: string;
  status: ReportStatus;
  version: number;
  producingLayer: string;
  title?: string;
  tldr?: string;
  issueFrame?: IssueFrame;
  transcript?: string;
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

export interface PolicyDescriptor {
  version: string;
  tiers: { tier: SourceTier; label: string; meaning: string }[];
  openSignals: { name: string; raises: SourceTier }[];
}
