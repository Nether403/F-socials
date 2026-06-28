// Pure view-model helpers shared by the report presentation components and their tests.
// Read-only over the AnalysisReport contract; nothing here mutates the report or touches the gate.
//
// ponytail: the proven primitives (topFramingSignal, issueFrameAxisText, TIER) already live in
// Report.tsx. Re-export them here so components/tests have one import surface and a single source
// of truth — no logic is duplicated.
import type { AnalysisReport, Claim, IssueFrame } from '../api/types';

export { topFramingSignal, issueFrameAxisText, severityTagCls, TIER } from './Report';

const nonBlank = (s: string | undefined): s is string => typeof s === 'string' && s.trim().length > 0;

// Rationale text for a claim: evidence description first, source basis as fallback, else nothing.
// Whitespace-only values count as absent so the Rationale_Block omits rather than shows a blank.
export function claimRationale(claim: Claim): string | undefined {
  if (nonBlank(claim.evidenceDescription)) return claim.evidenceDescription;
  if (nonBlank(claim.sourceBasis)) return claim.sourceBasis;
  return undefined;
}

// Magnitude above which an issue-frame axis counts as a strong, single-angle lean.
const STRONG_AXIS = 0.8;

// Pole name for each axis whose magnitude exceeds 0.8, choosing the pole that matches the axis sign
// (negative → low pole, positive → high pole — same convention as issueFrameAxisText). Empty when
// no axis is strong; non-finite magnitudes that are not > 0.8 (e.g. NaN) are excluded.
export function strongAxisPoles(issueFrame: IssueFrame): string[] {
  const poles: string[] = [];
  if (Math.abs(issueFrame.x) > STRONG_AXIS) {
    poles.push(issueFrame.x < 0 ? 'state / collective' : 'market / individual');
  }
  if (Math.abs(issueFrame.y) > STRONG_AXIS) {
    poles.push(issueFrame.y < 0 ? 'libertarian' : 'authoritarian');
  }
  return poles;
}

// Truncate a label to `max` characters for display, flagging when truncation occurred. The shown
// text is never longer than `max` (the ellipsis replaces the final character); the full label is
// preserved by the caller for the hover/focus title, so no characters are lost.
export function truncateLabel(label: string, max = 120): { shown: string; truncated: boolean } {
  if (label.length <= max) return { shown: label, truncated: false };
  return { shown: label.slice(0, max - 1) + '…', truncated: true };
}

// Per-section item counts; each equals the length of its collection in the report.
export function sectionCounts(report: AnalysisReport): {
  claims: number;
  framingSignals: number;
  contextCards: number;
  perspectives: number;
} {
  return {
    claims: report.claims.length,
    framingSignals: report.framingSignals.length,
    contextCards: report.contextCards.length,
    perspectives: report.perspectives.length,
  };
}
