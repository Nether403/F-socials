// Example tests for the invariant-gate runtime guard — Requirement 9.2.
//
// The guard does not re-implement the gate; it runs assembleReport against pinned
// fixtures and throws if any outcome diverges from the pinned expected status.
// (1) Against the real assembleReport (the default), the guard must pass.
// (2) Against a stub that weakens a gate condition (lets a needs_review case through
//     as ready), the guard must detect the divergence and throw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInvariantGateIntact } from '../../src/router/guard';
import type { AssembleInput } from '../../src/core/assemble';

test('guard passes against the real assembleReport', () => {
  // Default parameter wires in the real core/assemble.ts gate.
  assert.doesNotThrow(() => assertInvariantGateIntact());
});

test('guard throws against a stub that weakens every gate condition (all ready)', () => {
  // A weakened gate that waves everything through: the overclaim, evidenceless-framing,
  // empty-claims, and low-confidence fixtures all expect needs_review, so this diverges.
  const alwaysReady = (_input: AssembleInput) => ({ status: 'ready' as const });
  assert.throws(() => assertInvariantGateIntact(alwaysReady), /diverged from its pinned behavior/);
});

test('guard throws against a stub that weakens a single gate condition (overclaim)', () => {
  // Stub mirrors the real gate except it stops holding back the overclaiming claim
  // (a claim asserting evidence strength with zero citations). That one weakened
  // condition is enough for the guard to fail fast.
  const weakenedOverclaim = (input: AssembleInput) => {
    const overclaimed = input.claims.some(
      (c) => c.evidenceStrength !== 'none' && (!c.citations || c.citations.length === 0),
    );
    const evidenceless = input.framingSignals.some(
      (f) => !f.examples?.length || f.examples.some((e) => !e.text?.trim() || !e.explanation?.trim()),
    );
    const empty = input.claims.length === 0;
    const lowConfidence = input.confidence < 0.4;
    // Note: `overclaimed` is intentionally NOT consulted — the weakening under test.
    const status = evidenceless || empty || lowConfidence ? 'needs_review' : 'ready';
    return { status: status as 'ready' | 'needs_review' };
  };
  assert.throws(() => assertInvariantGateIntact(weakenedOverclaim), /overclaim/);
});

test('guard throws against a stub that holds back the honest-none ready case', () => {
  // The opposite failure mode: a gate that wrongly rejects the valid honest-none state
  // (strength none, zero citations) must also be caught, since that fixture expects ready.
  const alwaysReview = (_input: AssembleInput) => ({ status: 'needs_review' as const });
  assert.throws(() => assertInvariantGateIntact(alwaysReview), /honest-none ready case/);
});
