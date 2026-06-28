import { type JSX } from 'react';
import { truncateLabel } from './reportView';

// Descriptive, spatial issue-frame position chip (AllSides-style) — a lens, never a judge.
// It states *where* content/perspective framing sits; it is never a verdict, truthfulness or
// source-reliability rating, ranking, or numeric score (Req 5.7).
//
// Honest absence over implied judgment: with no label there is nothing to describe, so the chip
// is omitted entirely rather than rendering a placeholder marker (Req 5.2, 5.4).
//
// Long labels are truncated to 120 chars with an ellipsis; the full label stays reachable via the
// `title` (hover) and keyboard focus (`tabIndex={0}`) so no text is lost (Req 5.1, 5.3).
export function IssueFrameChip({ label }: { label?: string }): JSX.Element | null {
  if (!label || label.trim().length === 0) return null;
  const { shown, truncated } = truncateLabel(label, 120);
  return (
    <span
      className="tag info"
      title={truncated ? label : undefined}
      tabIndex={truncated ? 0 : undefined}
    >
      {shown}
    </span>
  );
}
