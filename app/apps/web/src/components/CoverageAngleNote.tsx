import type { JSX } from 'react';
import type { IssueFrame } from '../api/types';
import { strongAxisPoles } from './reportView';

// Coverage_Angle_Note: a descriptive "covered from one angle" note (Ground News blindspot, mapped to
// the lens). Lens, not judge — it states *where* the content frames a topic and prompts seeking other
// perspectives; it never asserts the content is false/inaccurate/wrong, is never a verdict, and never
// attaches a rating or label to the Creator.
//
// ponytail: reuses the existing `.mini-card` card styling and the shared `strongAxisPoles` helper —
// no new style class, no duplicated axis logic.

// Join pole names readably: "a", "a and b", "a, b and c".
function joinPoles(poles: string[]): string {
  if (poles.length <= 1) return poles[0] ?? '';
  return poles.slice(0, -1).join(', ') + ' and ' + poles[poles.length - 1];
}

// Returns null when there is no issue frame (Req 4.4) or no axis exceeds 0.8 (Req 4.2). Otherwise
// renders the fixed descriptive copy naming the strong-axis poles (Req 4.1, 4.3). The perspectives
// directive clause is appended only when `hasPerspectives` is true (Req 4.5) and dropped otherwise
// (Req 4.6).
export function CoverageAngleNote({
  issueFrame,
  hasPerspectives,
}: {
  issueFrame?: IssueFrame;
  hasPerspectives: boolean;
}): JSX.Element | null {
  if (!issueFrame) return null;
  const poles = strongAxisPoles(issueFrame);
  if (poles.length === 0) return null;
  return (
    <div className="mini-card">
      <div className="sub">Covered from one angle</div>
      <p>
        This content frames the topic from one angle — leaning toward {joinPoles(poles)}.
        {hasPerspectives ? ' Seeking other perspectives can round out the picture.' : ''}
      </p>
    </div>
  );
}
