// Feature: report-graph-normalization — interface-parity smoke test.
// Validates: Requirements 6.1, 6.4
//
// Both repository drivers must implement the Repository dual-write contract:
// hasReportGraph / listReportIds (Req 6.1), and the memory driver must expose
// its Normalized_Rows (claimRows / citationRows / perspectiveRows) for test
// assertion without a database, mirroring the disputes/flags/auditRecords
// accessors (Req 6.4).
//
// This is a static/structural smoke test (node:test, no fast-check). It checks
// method existence on the Postgres prototype rather than instantiating the
// driver, so it needs no real database connection.

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';
import { PostgresRepository } from '../src/infra/postgres';

test('6.1: PostgresRepository implements the dual-write contract methods', () => {
  // Check the prototype to avoid constructing with a real pg Pool.
  const proto = PostgresRepository.prototype as unknown as Record<string, unknown>;
  assert.equal(typeof proto.hasReportGraph, 'function', 'PostgresRepository.hasReportGraph should exist');
  assert.equal(typeof proto.listReportIds, 'function', 'PostgresRepository.listReportIds should exist');
  // saveReport carries the dual-write guarantee — it must be present too.
  assert.equal(typeof proto.saveReport, 'function', 'PostgresRepository.saveReport should exist');
});

test('6.1: InMemoryRepository implements the dual-write contract methods', () => {
  const repo = new InMemoryRepository();
  assert.equal(typeof repo.hasReportGraph, 'function', 'InMemoryRepository.hasReportGraph should exist');
  assert.equal(typeof repo.listReportIds, 'function', 'InMemoryRepository.listReportIds should exist');
  assert.equal(typeof repo.saveReport, 'function', 'InMemoryRepository.saveReport should exist');
});

test('6.4: InMemoryRepository exposes Normalized_Rows accessors as Maps', () => {
  const repo = new InMemoryRepository();
  assert.ok(repo.claimRows instanceof Map, 'claimRows should be a Map for test assertion');
  assert.ok(repo.citationRows instanceof Map, 'citationRows should be a Map for test assertion');
  assert.ok(repo.perspectiveRows instanceof Map, 'perspectiveRows should be a Map for test assertion');
  // Mirrors the existing disputes/flags/auditRecords accessors that tests rely on.
  assert.ok(Array.isArray(repo.disputes), 'disputes accessor should remain available');
  assert.ok(Array.isArray(repo.flags), 'flags accessor should remain available');
  assert.ok(repo.auditRecords instanceof Map, 'auditRecords accessor should remain available');
});
