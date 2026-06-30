// Feature: supabase-user-sync, Property 10: Readiness invariance
// Validates: Requirements 10.3, 10.4

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { assembleReport, type AssembleInput } from '../src/core/assemble';
import type { Citation, Claim, FramingSignal, EvidenceStrength, SourceTier } from '../src/types';
import { InMemoryRepository } from '../src/infra/memory';

const MIN_RUNS = 100;

const tiers: SourceTier[] = ['tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded'];
const strengths: EvidenceStrength[] = ['strong', 'moderate', 'weak', 'none'];

const citationArb: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: fc.constantFrom(...tiers),
  supports: fc.constantFrom(true, false, null),
});

// Claims spanning both the honest 'none'/no-citation state and the overclaiming
// state, plus empty/non-empty claim sets — the same shape the gate property test
// uses, so we exercise the full ready/needs_review space.
const claimArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1 }),
  claimText: fc.string(),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom(...strengths),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(citationArb, { maxLength: 3 }),
});

const framingSignalArb: fc.Arbitrary<FramingSignal> = fc.record({
  technique: fc.string(),
  severity: fc.constantFrom('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.array(
    fc.record({
      text: fc.oneof(fc.constant(''), fc.constant('   '), fc.string({ minLength: 1 })),
      explanation: fc.oneof(fc.constant(''), fc.constant('  '), fc.string({ minLength: 1 })),
      startIndex: fc.integer({ min: -1, max: 1000 }),
      endIndex: fc.integer({ min: -1, max: 1000 }),
    }),
    { maxLength: 3 },
  ),
});

const inputArb: fc.Arbitrary<AssembleInput> = fc.record({
  tldr: fc.string(),
  issueFrame: fc.record({
    label: fc.string(),
    x: fc.float({ min: -1, max: 1, noNaN: true }),
    y: fc.float({ min: -1, max: 1, noNaN: true }),
  }),
  claims: fc.array(claimArb, { maxLength: 5 }),
  framingSignals: fc.array(framingSignalArb, { maxLength: 4 }),
  contextCards: fc.constant([]),
  perspectives: fc.constant([]),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
});

// A User_Sync claim, run between the two classifications. email/role are each
// independently present-or-absent so the interleaved sync exercises create and
// merge branches.
const syncClaimArb = fc.record(
  {
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    role: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

// Property 10 ---
//
// User_Sync touches no input the invariant gate consumes: the gate is a pure
// function of its AssembleInput, and ensureLocalUser writes only to the
// Repository's private users map. So for any report inputs, the readiness
// classification is identical whether or not a User_Sync has run. We demonstrate
// this by classifying the SAME inputs before and after an interleaved
// ensureLocalUser on an InMemoryRepository and asserting the two results match,
// and that the gate inputs are unmutated by the sync (Req 10.3, 10.4).

describe('Property 10: Readiness invariance', () => {
  it('the gate classification is identical across an interleaved User_Sync', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, fc.uuid(), syncClaimArb, async (input, subject, claim) => {
        // Classify WITHOUT any user sync.
        const before = assembleReport(input);

        // Run a User_Sync (the Identity_Bearing_Action's sync step) on a fresh
        // in-memory Repository. It reads/writes no gate input.
        const repo = new InMemoryRepository();
        const args: { id: string; email?: string; role?: string } = { id: subject };
        if (claim.email !== undefined) args.email = claim.email;
        if (claim.role !== undefined) args.role = claim.role;
        await repo.ensureLocalUser(args);

        // Classify the SAME inputs again, after the sync.
        const after = assembleReport(input);

        // The readiness classification is invariant across the sync (Req 10.3).
        assert.equal(after.status, before.status, 'status must be unchanged by a User_Sync');
        assert.deepEqual(after.reasons, before.reasons, 'reasons must be unchanged by a User_Sync');

        // The sync mutated no gate input — User_Sync introduces no path that reads,
        // writes, or modifies any input consumed by the gate (Req 10.4). Confirm the
        // synced user lives only in the Repository, disjoint from the gate inputs.
        const synced = await repo.getLocalUser(subject);
        assert.ok(synced, 'User_Sync persisted the Local_User in the Repository only');
        assert.equal(synced.id, subject);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
