// Provider interfaces — the swap points. Replacing a mock with a real service
// (OpenAI, YouTube, Google Fact Check, GDELT...) means implementing one of these.
// No core/pipeline code changes when you swap.

import type {
  RawInput,
  Claim,
  Citation,
  ContextCard,
  EvidenceStrength,
  IssueFrame,
  PerspectiveLink,
  ClaimType,
  FactCheckability,
  MatchType,
  Candidate,
} from '../types';

export interface Transcript {
  text: string;
  lang: string;
  title?: string;
  segments?: { start: number; text: string }[];
}

export interface TranscriptProvider {
  fetch(input: RawInput): Promise<Transcript>;
}

// What the LLM extraction stage returns (before evidence is attached and before
// framing-example offsets are computed against the transcript).
export interface ExtractionResult {
  tldr: string;
  issueFrame: IssueFrame;
  claims: Array<Pick<Claim, 'claimText' | 'transcriptSpan' | 'verifiability' | 'confidence' | 'sourceBasis'>>;
  framingSignals: Array<{
    technique: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    examples: Array<{ text: string; explanation: string }>;
  }>;
  contextCards: ContextCard[];
}

export interface LLMProvider {
  extract(transcript: Transcript): Promise<ExtractionResult>;
}

export interface EvidenceProvider {
  gather(claimText: string): Promise<{ evidenceStrength: EvidenceStrength; citations: Citation[] }>;
}

export interface PerspectiveProvider {
  find(topic: string): Promise<PerspectiveLink[]>;
}

// Claim_Verification_Router provider swap points. Both are LLM judgments in prod
// and deterministic seeded mocks offline, keeping the router's orchestration pure.

export interface ClaimNormalizer {
  // Stage 1 of the router. LLM-backed in prod; deterministic mock offline.
  normalize(originalClaim: string): Promise<{
    canonicalClaim: string;
    claimType: ClaimType;
    factCheckability: FactCheckability;
  }>;
}

export interface CandidateValidator {
  // Classifies one Candidate against the ORIGINAL claim (not the query variant).
  validate(
    originalClaim: string,
    candidate: Candidate,
  ): Promise<{
    matchType: MatchType;
    matchConfidence: number; // 0..1 inclusive
  }>;
}

export interface Providers {
  transcript: TranscriptProvider;
  llm: LLMProvider;
  evidence: EvidenceProvider;
  perspective: PerspectiveProvider;
  normalizer: ClaimNormalizer;
  validator: CandidateValidator;
}
