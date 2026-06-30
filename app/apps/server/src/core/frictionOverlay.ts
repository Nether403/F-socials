// Feed Friction Dial — pure projection of a ready AnalysisReport into
// the lens-safe overlay payload. Structurally emits no verdict, no creator
// field, no aggregate score. Never throws, no side effects, no I/O.

import type { AnalysisReport, EvidenceStrength } from '../types';

export interface FrictionSignal {
  technique: string;
  severity: 'low' | 'medium' | 'high';
  quote: string;
  explanation: string;
}

export interface FrictionEvidenceItem {
  claimText: string;
  evidenceStrength: EvidenceStrength; // 'none' | 'weak' | 'moderate' | 'strong'
}

export interface FrictionOverlayData {
  reportId: string;
  framingSignals: FrictionSignal[];     // highest-severity first; tie => report-data order
  evidenceSummary: FrictionEvidenceItem[];
  reportUrl: string;                    // full report view URL
}

const SEVERITY_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };

/**
 * Pure projection of an AnalysisReport into its friction overlay data.
 * One FrictionSignal per report FramingSignal (technique + first example's
 * quote/explanation); one FrictionEvidenceItem per claim (text + label).
 * Sorted highest-severity-first with report-data order as stable tie-break.
 */
export function projectFrictionOverlay(report: AnalysisReport, baseUrl: string): FrictionOverlayData {
  // Extract framing signals — one per report framing signal
  const unsorted: FrictionSignal[] = report.framingSignals.map((fs) => ({
    technique: fs.technique,
    severity: fs.severity,
    quote: fs.examples[0]?.text ?? '',
    explanation: fs.examples[0]?.explanation ?? '',
  }));

  // Stable sort: highest severity first; ties preserve report-data order
  const framingSignals = unsorted.slice().sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );

  // Per-claim evidence items — labels only, no aggregate score
  const evidenceSummary: FrictionEvidenceItem[] = report.claims.map((c) => ({
    claimText: c.claimText,
    evidenceStrength: c.evidenceStrength,
  }));

  // Build report URL using shareSlug when available, else id
  const slug = report.shareSlug || report.id;
  const reportUrl = `${baseUrl}/report/${slug}`;

  return { reportId: report.id, framingSignals, evidenceSummary, reportUrl };
}
