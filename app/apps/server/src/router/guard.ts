// Invariant-gate runtime guard — Requirement 9.2.
//
// `core/assemble.ts` is the codified moat: it gates a report to `ready` only when
// no claim overclaims, every framing signal is evidenced, confidence clears the
// floor, and at least one claim exists. This guard does NOT re-implement that logic
// (that would be a second gate to drift out of sync). Instead it runs the REAL
// `assembleReport` against pinned fixtures covering the four gate conditions plus
// the honest-`none` ready case, and throws if any outcome diverges from the pinned
// expected status. If the gate is ever weakened (e.g. it stops holding back an
// overclaiming claim), this fails fast at worker boot — not in code review.
//
// It does not, and must not, modify `core/assemble.ts` (Requirement 9.1).

import { assembleReport, type AssembleInput } from '../core/assemble';
import type { Claim, FramingSignal } from '../types';

// A claim that honestly asserts no external review: strength 'none', zero citations.
// This is the VALID, served honest-none state the gate must accept as `ready`.
function honestNoneClaim(): Claim {
  return {
    id: 'guard-claim',
    claimText: 'A claim with no external review found.',
    verifiability: 'verifiable',
    evidenceStrength: 'none',
    confidence: 0.7,
    citations: [],
  };
}

// A claim that ASSERTS 'moderate' evidence but shows no citation — overclaiming.
function overclaimClaim(): Claim {
  return { ...honestNoneClaim(), evidenceStrength: 'moderate', citations: [] };
}

// A framing signal evidenced by a quote + explanation (the valid state).
function goodSignal(): FramingSignal {
  return {
    technique: 'Emotional Language',
    severity: 'medium',
    description: 'High-arousal wording that primes the reader.',
    examples: [
      {
        text: 'They ALWAYS lie!',
        explanation: 'Absolutist, emotionally charged phrasing.',
        startIndex: 0,
        endIndex: 16,
      },
    ],
  };
}

// A framing signal whose example is missing both quote and explanation.
function evidencelessSignal(): FramingSignal {
  return {
    technique: 'Emotional Language',
    severity: 'low',
    description: 'd',
    examples: [{ text: '', explanation: '', startIndex: -1, endIndex: -1 }],
  };
}

// A fully valid input; each fixture perturbs exactly one dimension so a divergence
// pinpoints which gate condition was weakened.
function valid(overrides: Partial<AssembleInput>): AssembleInput {
  return {
    tldr: 'summary',
    issueFrame: { label: 'mixed', x: 0, y: 0 },
    claims: [honestNoneClaim()],
    framingSignals: [goodSignal()],
    contextCards: [],
    perspectives: [],
    confidence: 0.7,
    ...overrides,
  };
}

interface GateFixture {
  name: string;
  input: AssembleInput;
  expected: AssembleResultStatus;
}

type AssembleResultStatus = 'ready' | 'needs_review';

const FIXTURES: GateFixture[] = [
  {
    name: 'overclaim (strength != none with zero citations)',
    input: valid({ claims: [overclaimClaim()] }),
    expected: 'needs_review',
  },
  {
    name: 'evidenceless framing (example missing quote/explanation)',
    input: valid({ framingSignals: [evidencelessSignal()] }),
    expected: 'needs_review',
  },
  {
    name: 'empty claims (no claims extracted)',
    input: valid({ claims: [] }),
    expected: 'needs_review',
  },
  {
    // floor is 0.4; 0.2 sits below it.
    name: 'low confidence (below CONFIDENCE_FLOOR)',
    input: valid({ confidence: 0.2 }),
    expected: 'needs_review',
  },
  {
    name: 'honest-none ready case (strength none, zero citations, valid framing/confidence/claims)',
    input: valid({}),
    expected: 'ready',
  },
];

/**
 * Runs the real `assembleReport` against each pinned fixture and throws if any
 * outcome diverges from the pinned expected status. Call once at worker boot so a
 * weakened invariant gate refuses to start rather than serving unguarded reports.
 *
 * `assemble` defaults to the real `assembleReport` and exists only as a test seam:
 * passing a weakened stub lets the guard's own divergence-detection be verified
 * (Requirement 9.2). Production callers pass no argument.
 */
export function assertInvariantGateIntact(
  assemble: (input: AssembleInput) => { status: AssembleResultStatus } = assembleReport,
): void {
  const divergences: string[] = [];

  for (const fixture of FIXTURES) {
    const actual = assemble(fixture.input).status;
    if (actual !== fixture.expected) {
      divergences.push(
        `  - ${fixture.name}: expected '${fixture.expected}', got '${actual}'`,
      );
    }
  }

  if (divergences.length > 0) {
    throw new Error(
      'Invariant gate (core/assemble.ts) has diverged from its pinned behavior — ' +
        'refusing to start. The codified moat must not be weakened:\n' +
        divergences.join('\n'),
    );
  }
}

// Guarded inline self-check: `node guard.js` (or tsx) runs the assertion and prints pass.
// ponytail: import.meta.url vs argv[1] comparison is the standard ESM "run directly" idiom.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guard.ts')) {
  assertInvariantGateIntact();
  // eslint-disable-next-line no-console
  console.log('assertInvariantGateIntact: pass (5 fixtures)');
}
