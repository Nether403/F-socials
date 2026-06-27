// The bridging band: keep moderately-divergent, low-dehumanization candidates;
// drop echo (too similar), extremes (too divergent), and dehumanizing sources.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBridging, type ScoredPerspective } from '../src/providers/perspective';

const mk = (url: string, divergence: number, dehumanization: number): ScoredPerspective => ({
  url,
  issueFrameLabel: 'x',
  divergence,
  dehumanization,
  whyIncluded: 'y',
});

test('keeps the bridging band, drops echo / extremes / dehumanizing', () => {
  const kept = filterBridging([
    mk('echo', 0.05, 0.0), // too similar -> drop
    mk('bridge-a', 0.4, 0.1), // keep
    mk('bridge-b', 0.7, 0.2), // keep
    mk('extreme', 0.95, 0.1), // too divergent -> drop
    mk('toxic', 0.5, 0.8), // dehumanizing -> drop
  ]);
  assert.deepEqual(
    kept.map((p) => p.url),
    ['bridge-a', 'bridge-b'],
  );
});

test('empty in, empty out', () => {
  assert.equal(filterBridging([]).length, 0);
});
