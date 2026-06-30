// Feature: intervention-and-scale, CI diff guard
// Fails the build if this feature's diff touches invariant-protected files.
// Validates: Requirements 13.1, 13.4, 13.6

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ponytail: git merge-base detects the fork point; falls back to HEAD~1 if
// main/master doesn't exist (local feature branch without remote).
function getMergeBase(): string {
  for (const branch of ['main', 'master', 'origin/main', 'origin/master']) {
    try {
      return execSync(`git merge-base HEAD ${branch}`, { cwd: serverDir, encoding: 'utf8' }).trim();
    } catch {
      // branch doesn't exist, try next
    }
  }
  // Fallback: compare against parent commit (still catches uncommitted + last commit)
  return 'HEAD~1';
}

const PROTECTED_FILES = [
  'src/core/assemble.ts',
  'src/pipeline/stages.ts',
];

test('13.1/13.6: invariant-protected files have zero diff against branch base', (t) => {
  let base: string;
  try {
    base = getMergeBase();
  } catch {
    t.skip('git not available or not inside a git repository');
    return;
  }

  let diffFiles: string[];
  try {
    // --name-only lists changed files; include staged + unstaged via diff against merge-base
    const raw = execSync(`git diff --name-only ${base} -- ${PROTECTED_FILES.join(' ')}`, {
      cwd: serverDir,
      encoding: 'utf8',
    });
    diffFiles = raw.trim().split('\n').filter(Boolean);
  } catch {
    t.skip('git diff failed (shallow clone or detached HEAD without history)');
    return;
  }

  assert.deepEqual(
    diffFiles,
    [],
    `Invariant-protected files must not be modified by this feature.\n` +
    `The following files were changed:\n  ${diffFiles.join('\n  ')}\n\n` +
    `core/assemble.ts is the codified moat (invariant gate) and pipeline/stages.ts ` +
    `defines the five pipeline stages. If a feature requires editing these files, ` +
    `the feature design is wrong — satisfy the gate by construction instead.`,
  );
});
