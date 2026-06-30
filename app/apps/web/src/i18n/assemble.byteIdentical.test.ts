// Feature: en-nl-localization — Byte-identical gate guard
// Confirms core/assemble.ts is identical to its committed state and that no
// localization import reaches into the invariant gate.
// Validates: Requirements 11.1

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const ASSEMBLE_REL = 'app/apps/server/src/core/assemble.ts';
const ASSEMBLE_ABS = resolve(REPO_ROOT, ASSEMBLE_REL);

describe('Invariant gate: core/assemble.ts byte-identical guard', () => {
  it('is byte-for-byte identical to its committed state', () => {
    // git show emits LF; on Windows with core.autocrlf=true the working copy has CRLF.
    // Normalize both to LF so the comparison tests content identity (the invariant we care
    // about) regardless of platform line-ending conventions.
    const committed = execSync(`git show HEAD:${ASSEMBLE_REL}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).replace(/\r\n/g, '\n');
    const onDisk = readFileSync(ASSEMBLE_ABS, 'utf-8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(committed);
  });

  it('contains no localization import (i18n, locale, language, catalog, translate)', () => {
    const content = readFileSync(ASSEMBLE_ABS, 'utf-8');
    const lines = content.split('\n');

    const localizationPatterns = [
      /\bimport\b.*\bi18n\b/i,
      /\bimport\b.*\blocale\b/i,
      /\bimport\b.*\blanguage\b/i,
      /\bimport\b.*\bcatalog\b/i,
      /\bimport\b.*\btranslate\b/i,
      /\brequire\b.*\bi18n\b/i,
      /\brequire\b.*\blocale\b/i,
      /\brequire\b.*\blanguage\b/i,
      /\brequire\b.*\bcatalog\b/i,
      /\brequire\b.*\btranslate\b/i,
    ];

    for (const line of lines) {
      for (const pattern of localizationPatterns) {
        expect(line, `localization import found: "${line.trim()}"`).not.toMatch(pattern);
      }
    }
  });
});
