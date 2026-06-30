// Trust_Gate — pure, total predicate over trust metrics + per-capability config.
// Satisfied IFF every condition holds with STRICT exceedance; any undefined metric
// or unset legal flag ⇒ not satisfied (fail-closed, Req 1.5, 1.6, 12.2).
// Never throws. No side effects. No imports beyond type-level.

export type Capability = 'feed_friction' | 'institutional_api' | 'coaching';

export interface TrustThresholds {
  citationCoverageMin: number;      // [0,1], default 0.0
  modelHumanAgreementMin: number;   // [0,1], default 0.0
  legalReviewComplete: boolean;     // default false
}

export interface TrustMetrics {
  citationCoverage: number | undefined;
  modelHumanAgreement: number | undefined;
}

export interface TrustGateResult {
  satisfied: boolean;
  reasons: string[];  // empty iff satisfied
}

export function evaluateTrustGate(m: TrustMetrics, t: TrustThresholds): TrustGateResult {
  const reasons: string[] = [];

  if (m.citationCoverage === undefined) {
    reasons.push('citationCoverage unavailable');
  } else if (m.citationCoverage <= t.citationCoverageMin) {
    reasons.push(`citationCoverage ${m.citationCoverage} does not exceed threshold ${t.citationCoverageMin}`);
  }

  if (m.modelHumanAgreement === undefined) {
    reasons.push('modelHumanAgreement unavailable');
  } else if (m.modelHumanAgreement <= t.modelHumanAgreementMin) {
    reasons.push(`modelHumanAgreement ${m.modelHumanAgreement} does not exceed threshold ${t.modelHumanAgreementMin}`);
  }

  if (!t.legalReviewComplete) {
    reasons.push('legal review not complete');
  }

  return { satisfied: reasons.length === 0, reasons };
}
