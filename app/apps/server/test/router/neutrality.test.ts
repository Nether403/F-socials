// Feature: claim-verification-router, Task 13.1: neutrality and dataset-licensing constraints.
// Static checks (node:test) that the router stays a lens, not a judge, and reuses only the
// open-signal Source_Tier_Policy:
//   1. No Ad Fontes / AllSides / MBFC source-reliability dataset is imported or used anywhere
//      in the router/source code (Req 5.3, non-goal "paid source-reliability datasets").
//   2. A real VerifiedClaim (from verifyClaim) and a real AuditRecord (from buildAuditRecord)
//      expose NO content-truth verdict field and NO creator-reliability field (Req 9.5).
// Validates: Requirements 5.3, 9.5

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { verifyClaim, type VerifyDeps, type VerifiedClaim } from '../../src/router/index';
import { buildAuditRecord } from '../../src/router/audit';
import { seededNormalizer } from '../../src/router/normalize';
import { classifyCitationTier } from '../../src/core/sourceTier';
import type { CandidateValidator } from '../../src/providers/types';
import type { Candidate } from '../../src/types';

// ── Locate the src/ tree from this test file (test/router/ -> ../../src). ────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'src');

// The banned source-reliability datasets (Req 5.3): while their commercial-use license is
// unresolved, none may be imported or used. Matched case-insensitively. Substrings cover
// the common spellings/identifiers ("Ad Fontes"/"adfontes", "AllSides"/"allsides",
// "MBFC"/"mediabiasfactcheck").
const BANNED_DATASET_TOKENS = ['ad fontes', 'adfontes', 'allsides', 'mbfc', 'mediabiasfactcheck'];

// Strip comments so a legitimate "upgrade path: MBFC / Ad Fontes" NOTE in a comment is not a
// false positive — only an actual data import/usage in real code should ever trip the check.
// Removes block comments first, then line comments (leaving `://` in URLs intact).
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */ block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // // line comments, but not the // in https://
}

// Recursively collect every .ts source file under a directory.
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

test('no banned source-reliability dataset (Ad Fontes / AllSides / MBFC) is imported or used in src/', () => {
  const files = collectTsFiles(SRC_DIR);
  assert.ok(files.length > 0, 'expected to find TypeScript source files to scan');

  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8')).toLowerCase();
    for (const token of BANNED_DATASET_TOKENS) {
      assert.ok(
        !code.includes(token),
        `banned source-reliability dataset reference "${token}" found as code (not a comment) in ${file}`,
      );
    }
  }
});

// ── Forbidden verdict / creator-reliability fields (Req 9.5). ─────────────────────────
// f-Socials is a lens, not a judge: no surface may carry a verdict on content truthfulness
// or a reliability rating tied to a creator. We assert these never appear as a KEY anywhere
// in a real VerifiedClaim or AuditRecord, scanning nested objects/arrays too. Substrings
// catch variants (e.g. "truthVerdict" via "verdict"); the listed tokens are specific enough
// not to collide with the legitimate keys (evidenceStrength, evidenceOutcome, sourceTier,
// supports, …).
const FORBIDDEN_KEY_SUBSTRINGS = [
  'verdict', // verdict, truthVerdict
  'truthfulness',
  'creatorreliability',
  'creatorrating',
  'reliabilityrating',
];

// Collect every object key reachable from a value (deep, through arrays and nested objects).
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

function assertNoForbiddenKeys(obj: unknown, label: string): void {
  for (const key of collectKeys(obj)) {
    const lower = key.toLowerCase();
    for (const banned of FORBIDDEN_KEY_SUBSTRINGS) {
      assert.ok(
        !lower.includes(banned),
        `${label} exposes a forbidden key "${key}" (matches "${banned}") — content-truth verdicts and creator-reliability ratings violate the lens-not-judge compass (Req 9.5)`,
      );
    }
  }
}

// A single tier2 candidate so a checkable claim can actually reach the Claim_Ledger and
// produce the richest VerifiedClaim shape (citations + audit populated).
const oneCandidate: Candidate = {
  sourceUrl: 'https://www.example.org/report',
  sourceName: 'Example Institution',
  excerpt: 'An institutional report.',
  sourceTier: 'tier2_institutional',
  isFactCheck: false,
  fromVariant: 'exact_normalized',
  retrievalRank: 0,
};

// Force every candidate to same_claim so a checkable claim reaches the ledger (a matched
// outcome carries citations — the path most likely to surface any stray verdict field).
const sameClaimValidator: CandidateValidator = {
  async validate() {
    return { matchType: 'same_claim', matchConfidence: 1 };
  },
};

function makeDeps(validator: CandidateValidator): VerifyDeps {
  return {
    normalizer: seededNormalizer,
    validator,
    retrieve: async () => [oneCandidate],
    classifyTier: (url) => classifyCitationTier(url),
  };
}

test('a real VerifiedClaim exposes no content-truth verdict or creator-reliability field', async () => {
  // Matched (checkable) claim: carries citations, useful context, context cards, audit.
  const matched: VerifiedClaim = await verifyClaim('The Berlin Wall fell in 1989', makeDeps(sameClaimValidator));
  assert.ok(matched.citations.length >= 1, 'expected a matched claim to carry at least one citation');
  assertNoForbiddenKeys(matched, 'VerifiedClaim (matched)');

  // not_fact_checkable claim: the honest-none shape (zero citations, empty audit pack).
  const opinion: VerifiedClaim = await verifyClaim(
    'I think pineapple is the best pizza topping',
    makeDeps(seededValidatorThatShouldNotRun()),
  );
  assert.equal(opinion.evidenceOutcome, 'not_fact_checkable');
  assertNoForbiddenKeys(opinion, 'VerifiedClaim (not_fact_checkable)');
});

// A validator that must never be called for the opinion claim (triage short-circuits before
// retrieval/validation); if it is ever called the test fails loudly rather than silently.
function seededValidatorThatShouldNotRun(): CandidateValidator {
  return {
    async validate() {
      throw new Error('validator must not run for a not_fact_checkable claim');
    },
  };
}

test('a real AuditRecord exposes no content-truth verdict or creator-reliability field', () => {
  const record = buildAuditRecord({
    originalClaim: 'Honestly, the bridge opened in 2011',
    canonicalClaim: 'The bridge opened in 2011.',
    claimType: 'factual_event',
    factCheckability: 'checkable',
    queryPack: [{ text: 'bridge opened 2011', kind: 'exact_normalized' }],
    candidates: [
      {
        candidate: oneCandidate,
        matchType: 'same_claim',
        matchConfidence: 0.9,
        selectedAsEvidence: true,
      },
    ],
    evidenceOutcome: 'matched_institutional_source',
    evidenceStrength: 'weak',
    prototypeVocab: 'supported',
  });
  assertNoForbiddenKeys(record, 'AuditRecord');
});
