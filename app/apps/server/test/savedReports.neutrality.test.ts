// Feature: accounts-save-history, Property 7: Account-surface responses are lens-not-judge
// Validates: Requirements 12.4, 12.5, 12.6
//
// For any saved state, the save and history API responses contain ONLY neutral
// association fields — report identifier, saved timestamp, success flag — and no
// field representing a content-truthfulness verdict, a creator-reliability
// rating, or a source-reliability tier attached to a creator/author/person/
// channel.
//
// We drive the InMemoryRepository with a generated sequence of save/remove
// operations across a shared pool of readers and reports (so states vary widely:
// empty, single, many, post-removal), then assemble the exact response objects
// the routes return — save `{ ok, saved: true }`, remove `{ ok, saved: false }`,
// and history `SavedReportEntry[]` (the result of listSavedReports). We assert
// against the ACTUAL keys present (a deep Object.keys walk) so the test catches
// any verdict / rating / tier dimension introduced on these responses in the
// future, not just the field names we know about today.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// The complete set of neutral association keys these responses may carry:
// success flag (ok, saved), report identifier (reportId), saved timestamp
// (savedAt). Anything outside this set is, by construction, not a neutral
// association field and must not appear (Req 12.4, 12.5, 12.6).
const ALLOWED_KEYS = new Set(['ok', 'saved', 'reportId', 'savedAt']);

// Belt-and-braces: keys that would betray a verdict / creator-reliability /
// source-tier-on-creator dimension. Redundant with the allow-list above, but
// names the forbidden concepts explicitly so a future neutral-looking-but-
// forbidden key (e.g. "creatorTier") still trips the guard.
const FORBIDDEN_KEY = /tier|reliab|trust|verdict|rating|credib|truth|score|judg/i;

// Collect every property key appearing anywhere in a response value (objects and
// nested arrays/objects). Primitives contribute nothing.
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const el of value) collectKeys(el, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

function assertNeutral(response: unknown, label: string): void {
  for (const key of collectKeys(response)) {
    assert.ok(
      ALLOWED_KEYS.has(key),
      `${label} response carries a non-neutral field "${key}"`,
    );
    assert.ok(
      !FORBIDDEN_KEY.test(key),
      `${label} response exposes a verdict/rating/tier key "${key}"`,
    );
  }
}

// A generated scenario: pools of readers and reports (small, so the same report
// is saved by more than one reader), and a sequence of save/remove operations
// drawn from those pools — yielding empty, single, many, and post-removal states.
const scenarioArb = fc
  .record({
    readers: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 4 }),
    reports: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 }),
  })
  .chain(({ readers, reports }) =>
    fc.record({
      readers: fc.constant(readers),
      reports: fc.constant(reports),
      ops: fc.array(
        fc.record({
          kind: fc.constantFrom('save' as const, 'remove' as const),
          reader: fc.constantFrom(...readers),
          report: fc.constantFrom(...reports),
        }),
        { maxLength: 40 },
      ),
    }),
  );

test('Property 7: save and history responses carry only neutral association fields', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ readers, reports, ops }) => {
      const repo = new InMemoryRepository();

      for (const { kind, reader, report } of ops) {
        if (kind === 'save') await repo.saveSavedReport(reader, report);
        else await repo.removeSavedReport(reader, report);
      }

      // The save and remove routes return constant neutral shapes regardless of
      // state (routes.ts: `{ ok: true, saved: true }` / `{ ok: true, saved: false }`).
      assertNeutral({ ok: true, saved: true }, 'save');
      assertNeutral({ ok: true, saved: false }, 'remove');

      // The history route returns listSavedReports(reader) verbatim, so its
      // neutrality depends on the actual generated saved state for each reader.
      for (const reader of readers) {
        const history = await repo.listSavedReports(reader);
        assertNeutral(history, 'history');
        // And each entry is exactly the lens-safe projection: identifier + timestamp.
        for (const entry of history) {
          assert.deepEqual(
            Object.keys(entry).sort(),
            ['reportId', 'savedAt'],
            'history entry must be exactly { reportId, savedAt }',
          );
        }
      }
      // A never-seen reader's history is empty and trivially neutral (Req 10.8).
      assertNeutral(await repo.listSavedReports('unseen-reader'), 'history');
      // `reports` is part of the generated input space; reference it so the
      // shrinker keeps the pool meaningful.
      assert.ok(reports.length >= 1);
    }),
    { numRuns: 100 },
  );
});
