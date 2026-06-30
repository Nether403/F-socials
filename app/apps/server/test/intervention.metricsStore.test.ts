// Feature: intervention-and-scale, task 2.5 — Metrics_Store aggregation unit test.
// Validates: Requirements 1.6, 1.8
//
// buildTrustMetrics feeds the already-persisted Evidence_Outcomes and Human_Signals
// through the pure KPI functions without re-deriving any metric math. This test
// pins two behaviours:
//   1. Seeded data → coverage/agreement pass through exactly what citationCoverage
//      and modelHumanAgreement compute directly from the same repository reads.
//   2. Empty data → fail-closed defaults { citationCoverage: 0, modelHumanAgreement
//      undefined } so the trust gate is not satisfied offline.

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';
import { buildTrustMetrics } from '../src/core/metricsStore';
import { citationCoverage, modelHumanAgreement } from '../src/core/kpi';
import type { AuditRecord, EvidenceOutcome } from '../src/types';

// Minimal valid AuditRecord; listEvidenceOutcomes reads only claimId + evidenceOutcome.
function makeRecord(claimId: string, evidenceOutcome: EvidenceOutcome): AuditRecord {
  return {
    claimId,
    originalClaim: 'o',
    canonicalClaim: 'c',
    claimType: 'factual_event',
    factCheckability: 'checkable',
    queryPack: [],
    candidates: [],
    evidenceOutcome,
    evidenceStrength: 'none',
    prototypeVocab: 'insufficient',
    createdAt: new Date().toISOString(),
  };
}

test('buildTrustMetrics passes coverage/agreement through the KPI functions for seeded data', async () => {
  const repo = new InMemoryRepository();

  // Two audited claims on r1: one Cited_Outcome + one Honest_None → coverage 1/2.
  await repo.saveAuditRecord('r1', makeRecord('c1', 'matched_fact_check'));
  await repo.saveAuditRecord('r1', makeRecord('c2', 'no_sufficient_evidence'));

  // A dispute on r1/c1 → one Human_Signal sharing a (reportId, claimId) with a model
  // outcome; a dispute is a disagreement, so agreement = 0/1 = 0.
  await repo.createDispute({ id: 'd1', reportId: 'r1', claimId: 'c1', reason: 'x', createdAt: new Date().toISOString() });
  // A flag carrying no claimId contributes no signal (mirrors the Postgres join).
  await repo.createFlag({ id: 'f1', reportId: 'r1', userId: 'u1', technique: 'cherry_picking', createdAt: new Date().toISOString() });

  // Independent oracle: compute directly from the same repository reads.
  const outcomes = await repo.listEvidenceOutcomes();
  const signals = await repo.listHumanSignals();
  const expectedCoverage = citationCoverage(outcomes);
  const expectedAgreement = modelHumanAgreement(
    outcomes.map((o) => ({ reportId: o.reportId, claimId: o.claimId, outcome: o.evidenceOutcome })),
    signals,
  );

  const metrics = await buildTrustMetrics({ repo });

  assert.equal(metrics.citationCoverage, expectedCoverage);
  assert.equal(metrics.modelHumanAgreement, expectedAgreement);
  // Pin the concrete known values too, so a regression in the wiring is obvious.
  assert.equal(metrics.citationCoverage, 0.5);
  assert.equal(metrics.modelHumanAgreement, 0);
});

test('buildTrustMetrics returns fail-closed defaults for empty data', async () => {
  const repo = new InMemoryRepository();

  const metrics = await buildTrustMetrics({ repo });

  assert.deepEqual(metrics, { citationCoverage: 0, modelHumanAgreement: undefined });
});
