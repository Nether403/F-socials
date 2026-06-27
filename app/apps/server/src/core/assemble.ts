// The invariant gate — the heart of "a lens, not a judge".
//
// A report may only reach 'ready' if:
//   1. no claim ASSERTS an evidence strength it cannot cite,
//      i.e. a claim with evidenceStrength weak/moderate/strong must have >=1 citation.
//      (A claim with evidenceStrength 'none' and zero citations is a VALID, honest
//       state: "no external review found" — we show it plainly, we don't hide it.)
//   2. every framing signal has both an evidence span and an explanation,
//   3. overall confidence is above the floor,
//   4. at least one claim was extracted.
//
// Otherwise it becomes 'needs_review' (a human looks before it is served).
//
// Note: framing signals are evidenced by their quote + explanation, NOT an external
// source — framing is about rhetoric. Factual omissions that need a source live in
// contextGaps, not here.
//
// If this gate ever has to be weakened to ship a feature, the feature is wrong.

import type { Claim, ContextCard, FramingSignal, IssueFrame, PerspectiveLink } from '../types';

export interface AssembleInput {
  tldr: string;
  issueFrame: IssueFrame;
  claims: Claim[];
  framingSignals: FramingSignal[];
  contextCards: ContextCard[];
  perspectives: PerspectiveLink[];
  confidence: number;
}

export interface AssembleResult extends AssembleInput {
  status: 'ready' | 'needs_review';
  reasons: string[];
}

export const CONFIDENCE_FLOOR = 0.4;

export function assembleReport(input: AssembleInput): AssembleResult {
  const reasons: string[] = [];

  const overclaimed = input.claims.filter(
    (c) => c.evidenceStrength !== 'none' && (!c.citations || c.citations.length === 0),
  );
  if (overclaimed.length > 0) {
    reasons.push(`${overclaimed.length} claim(s) assert evidence strength without a citation`);
  }

  // A framing signal must carry at least one example, each with a quote + explanation.
  const evidenceless = input.framingSignals.filter(
    (f) => !f.examples?.length || f.examples.some((e) => !e.text?.trim() || !e.explanation?.trim()),
  );
  if (evidenceless.length > 0) {
    reasons.push(`${evidenceless.length} framing signal(s) without evidence examples`);
  }

  if (input.claims.length === 0) {
    reasons.push('no claims extracted');
  }

  if (input.confidence < CONFIDENCE_FLOOR) {
    reasons.push(`confidence ${input.confidence.toFixed(2)} below floor ${CONFIDENCE_FLOOR}`);
  }

  return {
    ...input,
    status: reasons.length === 0 ? 'ready' : 'needs_review',
    reasons,
  };
}
