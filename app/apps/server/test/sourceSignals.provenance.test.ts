// Feature: trust-and-launch-bundle, provenance (Validates: Requirements 2.2, 2.7)
//
// Proves the source-tier seed data uses ONLY open signals (no commercially-encumbered
// reliability datasets — 2.2) and carries NO content-creator dimension (2.7). The policy
// classifies sources and citations only, never creators.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as signals from '../src/core/data/sourceSignals';

const sourcePath = fileURLToPath(
  new URL('../src/core/data/sourceSignals.ts', import.meta.url),
);
const rawText = readFileSync(sourcePath, 'utf8');
const rawLower = rawText.toLowerCase();

// 2.2 — seeds derive only from open signals, never from Ad Fontes / AllSides / MBFC
// or any other reliability dataset with an unresolved commercial-use license.
test('seed data references no commercially-encumbered reliability dataset (2.2)', () => {
  const banned = [
    'ad fontes',
    'adfontes',
    'allsides',
    'mbfc',
    'media bias fact check',
    'media bias/fact check',
  ];
  for (const phrase of banned) {
    assert.ok(
      !rawLower.includes(phrase),
      `sourceSignals.ts must not reference "${phrase}" — seeds use open signals only (2.2)`,
    );
  }
});

// 2.7 — the policy applies to sources/citations only and produces no creator rating.
// Structural guarantee: every export is a domain set (strings) or suffix rules
// (RegExps); none is a record carrying a creator/author/channel dimension.
test('exports carry no content-creator dimension (2.7)', () => {
  const entries = Object.entries(signals);
  assert.ok(entries.length > 0, 'module should export seed data');

  for (const [name, value] of entries) {
    // No export is named for a creator-level concept.
    assert.ok(
      !/creator|author|channel|influencer|account|handle/i.test(name),
      `export "${name}" must not name a content-creator dimension (2.7)`,
    );

    if (value instanceof Set) {
      // Domain sets only — every member is a bare domain string.
      for (const member of value) {
        assert.equal(
          typeof member,
          'string',
          `export "${name}" must contain only domain strings, got ${typeof member}`,
        );
      }
    } else if (Array.isArray(value)) {
      // Suffix rules only — every member is a RegExp.
      for (const member of value) {
        assert.ok(
          member instanceof RegExp,
          `export "${name}" array must contain only suffix RegExps`,
        );
      }
    } else {
      // Anything else could smuggle a keyed creator field — reject it.
      assert.fail(
        `export "${name}" must be a domain Set or a RegExp array, got ${typeof value}`,
      );
    }
  }
});
