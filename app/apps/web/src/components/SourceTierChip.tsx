// Source_Tier_Chip (NewsGuard-style, sources only). Lens, not judge: a reliability tier attaches
// only to a cited source or a perspective source — there is no `tier` prop for a Creator and the
// component has no notion of one, so structurally no creator chip can exist (Req 6.3, 8.4).
//
// ponytail: reuses the existing `.tag muted` chip styling and the shared `TIER` map (the human-
// readable label, never the internal id) from Report.tsx — no new style class, no duplicated map.
import type { JSX } from 'react';
import type { SourceTier } from '../api/types';
import { TIER } from './reportView';

// Renders the human-readable tier label as a chip. The tier is conveyed by that text label, sitting
// adjacent to any color indicator — never by color alone (Req 6.4, 7.1). Returns null on honest
// absence: a missing tier, or a value outside the SourceTier union (an upstream contract violation),
// renders nothing rather than a placeholder/empty chip or a raw identifier (Req 6.5).
export function SourceTierChip({ tier }: { tier?: SourceTier }): JSX.Element | null {
  if (!tier || !Object.prototype.hasOwnProperty.call(TIER, tier)) return null;
  return <span className="tag muted">{TIER[tier]}</span>;
}
