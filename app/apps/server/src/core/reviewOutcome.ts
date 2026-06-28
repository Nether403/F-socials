// Resolution vocabulary (Requirements 4.2, 9.1, 9.3): the single source of truth for
// the bounded Resolution_Outcome set, reused by the review zod schema and the
// Neutrality_Check.
//
// Each value describes the report's FRAMING or EVIDENCE only — never the content
// creator, channel, or author, and never a truthfulness verdict. f-Socials is a lens,
// not a judge: there is deliberately NO value such as "true", "false", "accurate",
// "misinformation", "unreliable", or any creator/channel descriptor (Req 9.1, 9.3).

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const RESOLUTION_OUTCOMES = [
  'framing_example_confirmed', // a surfaced framing signal's evidenced example holds up
  'framing_example_weak', // a surfaced framing signal's example is thin/unconvincing
  'evidence_adequately_cited', // claims' asserted evidence strength matches their citations
  'evidence_overstated', // a claim asserts more evidence strength than it cites
  'context_gap_noted', // a useful missing-context item was identified
  'no_change_needed', // review found nothing to adjust
  'needs_further_review', // inconclusive / escalate
] as const;

export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

// ponytail: one runnable self-check (run `node --import tsx src/core/reviewOutcome.ts`).
// Full property/neutrality coverage is tasks 11.1–11.2; this only fails fast if the
// vocabulary regresses — the set must stay non-empty and free of any creator-reliability
// or truthfulness-verdict token, which is the load-bearing neutrality guarantee.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.ok(RESOLUTION_OUTCOMES.length > 0, 'outcome set must be non-empty');

  // Banned tokens: any creator-reliability rating or truthfulness verdict.
  const BANNED = ['true', 'false', 'accurate', 'misinformation', 'unreliable', 'reliable', 'credib', 'trustworth', 'liar', 'fake'];
  for (const outcome of RESOLUTION_OUTCOMES) {
    for (const token of BANNED) {
      assert.ok(!outcome.includes(token), `outcome "${outcome}" contains banned token "${token}"`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`reviewOutcome self-check passed: ${RESOLUTION_OUTCOMES.length} framing/evidence-only outcomes, no banned token.`);
}
