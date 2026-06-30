import type { JSX } from 'react';

// Rationale_Block: a short, plain-language label + the unaltered source-field text.
// Lens, not judge — the label is the only added text; the field text is rendered
// verbatim with no prefix, suffix, verdict, or creator rating (Req 3.1, 3.4, 3.5).
export function RationaleBlock({
  label,
  text,
}: {
  label: string;
  text?: string;
}): JSX.Element | null {
  // Honest absence: omit entirely for absent/empty/whitespace-only text — no placeholder (Req 3.5).
  if (!text || text.trim() === '') return null;
  return (
    <div className="rationale">
      <div className="sub">{label}</div>
      <p>{text}</p>
    </div>
  );
}
