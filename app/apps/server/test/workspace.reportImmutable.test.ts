// Feature: institutional-workspace, Property 11: Report content is immutable across workspace operations
// Validates: Requirements 11.3
//
// For any persisted report, performing an arbitrary interleaved sequence of
// workspace operations that reference that report — adding it to / removing it
// from a Shared_Collection, reading the collection's items, annotating it, and
// listing its annotations — leaves the report's stored content (claims,
// citations, framing signals, readiness state, everything) byte-for-byte
// unchanged from its value before the operations. Approach: persist a report via
// repo.saveReport, seed a workspace + collection, snapshot the serialized content
// from getReport, drive a generated op-sequence through the only workspace access
// path, then re-fetch and assert the serialization is byte-for-byte identical.
// The workspace stores only associations (collection items, annotations) — it
// never owns or mutates report content.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { gateValidReportArbitrary } from './reportGraph.arb';

// Reader identity is the Supabase JWT subject (an opaque non-empty string).
const readerArb = fc.string({ minLength: 1, maxLength: 32 }).map((s) => `r${s}`);

// One workspace operation that references the report. A discriminated union so
// each op carries exactly the payload it needs — no array indexing, safe under
// noUncheckedIndexedAccess.
type Op =
  | { kind: 'add' }
  | { kind: 'remove' }
  | { kind: 'listItems' }
  | { kind: 'annotate'; authorId: string; text: string }
  | { kind: 'listAnnotations' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: 'add' }),
  fc.constant<Op>({ kind: 'remove' }),
  fc.constant<Op>({ kind: 'listItems' }),
  fc
    .record({ authorId: readerArb, text: fc.string({ minLength: 1, maxLength: 4000 }) })
    .map((r): Op => ({ kind: 'annotate', authorId: r.authorId, text: r.text })),
  fc.constant<Op>({ kind: 'listAnnotations' }),
);

test('Property 11: workspace operations never mutate stored report content', async () => {
  await fc.assert(
    fc.asyncProperty(
      gateValidReportArbitrary,
      readerArb,
      fc.array(opArb, { minLength: 1, maxLength: 24 }),
      async (report, owner, ops) => {
        const repo = new InMemoryRepository();
        await repo.saveReport(report);

        // Seed a workspace + collection to operate within.
        const ws = await repo.createWorkspace(owner, 'classroom');
        const collection = await repo.createCollection(ws.id, 'reading set');

        // Byte-for-byte snapshot of the stored content before any workspace op.
        const before = JSON.stringify(await repo.getReport(report.id));

        // Drive the generated interleaved sequence through the only workspace
        // access path, every op referencing the persisted report id.
        for (const op of ops) {
          switch (op.kind) {
            case 'add':
              await repo.addCollectionItem(collection.id, report.id);
              break;
            case 'remove':
              await repo.removeCollectionItem(collection.id, report.id);
              break;
            case 'listItems':
              await repo.listCollectionItems(collection.id);
              break;
            case 'annotate':
              await repo.createAnnotation({
                workspaceId: ws.id,
                reportId: report.id,
                authorId: op.authorId,
                text: op.text,
              });
              break;
            case 'listAnnotations':
              await repo.listAnnotations(ws.id, report.id);
              break;
          }
        }

        // The stored report content — claims, citations, framing signals, and
        // readiness state — is unchanged after all workspace operations.
        const after = JSON.stringify(await repo.getReport(report.id));
        assert.equal(after, before, 'report content changed after workspace operations');
      },
    ),
    { numRuns: 100 },
  );
});
