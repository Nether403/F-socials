// Feature: claim-verification-router, audit persistence (task 10.2).
// The in-memory repository appends each AuditRecord to a per-reportId log,
// mirroring the Postgres audit_records table keyed by report_id.
// Validates: Requirements 6.1

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../../src/infra/memory';
import type { AuditRecord } from '../../src/types';

function makeRecord(claimId: string): AuditRecord {
  return {
    claimId,
    originalClaim: 'o',
    canonicalClaim: 'c',
    claimType: 'factual_event',
    factCheckability: 'checkable',
    queryPack: [],
    candidates: [],
    evidenceOutcome: 'no_sufficient_evidence',
    evidenceStrength: 'none',
    prototypeVocab: 'insufficient',
    createdAt: new Date().toISOString(),
  };
}

test('saveAuditRecord appends per-report, isolating distinct reports', async () => {
  const repo = new InMemoryRepository();

  await repo.saveAuditRecord('report-A', makeRecord('claim-1'));
  await repo.saveAuditRecord('report-A', makeRecord('claim-2'));
  await repo.saveAuditRecord('report-B', makeRecord('claim-3'));

  const a = repo.auditRecords.get('report-A');
  const b = repo.auditRecords.get('report-B');

  assert.ok(a && b, 'both reports have audit logs');
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((r) => r.claimId), ['claim-1', 'claim-2']);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.claimId, 'claim-3'); // length asserted to be 1 above
  assert.equal(repo.auditRecords.get('report-unknown'), undefined);
});
