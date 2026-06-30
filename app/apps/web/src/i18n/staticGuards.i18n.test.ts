// Feature: en-nl-localization — Static guard tests
// Asserts offline-first and no-dependency constraints: catalogs are static imports
// (no runtime fetch), no router/network/external-service dependency is introduced,
// the selector icon comes from lucide-react, and no server file was changed for
// localization.
// Validates: Requirements 3.5, 4.1, 4.5, 5.4, 10.1, 10.5, 10.7, 11.4

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper: read a source file relative to the web src root
function readSrc(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
}

// Helper: read a file relative to the i18n directory
function readI18n(filename: string): string {
  return readFileSync(resolve(__dirname, filename), 'utf-8');
}

describe('Static guard: catalogs are static imports (no runtime fetch)', () => {
  // Req 4.1, 4.5, 10.1, 10.5 — catalogs are synchronous bundled modules, no network
  const FORBIDDEN_PATTERNS = [
    { pattern: /\bfetch\s*\(/, label: 'fetch(' },
    { pattern: /\bimport\s*\(/, label: 'dynamic import(' },
    { pattern: /\bawait\b/, label: 'await' },
    { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
    { pattern: /\brequire\s*\(/, label: 'require(' },
  ];

  for (const file of ['en.ts', 'nl.ts']) {
    it(`${file} contains no runtime fetch or async patterns`, () => {
      const src = readI18n(file);
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(src), `${file} should not contain ${label}`).toBe(false);
      }
    });
  }
});

describe('Static guard: no router/network/external-service dependency', () => {
  // Req 3.5, 10.7 — no react-router, i18next, react-intl, or similar added
  it('package.json has no i18n/routing library in dependencies', () => {
    const pkgPath = resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const FORBIDDEN_PACKAGES = [
      'react-router',
      'react-router-dom',
      'i18next',
      'react-i18next',
      'react-intl',
      'formatjs',
      '@formatjs/intl',
      'next-intl',
      'lingui',
      '@lingui/core',
      '@lingui/react',
    ];

    for (const pkg of FORBIDDEN_PACKAGES) {
      expect(allDeps[pkg], `"${pkg}" should not be in dependencies`).toBeUndefined();
    }
  });
});

describe('Static guard: Language_Selector icon from lucide-react', () => {
  // Req 8.8 — icon sourced from lucide-react
  it('LanguageSelector.tsx imports from lucide-react', () => {
    const src = readSrc('components/LanguageSelector.tsx');
    expect(src).toMatch(/from\s+['"]lucide-react['"]/);
  });
});

describe('Static guard: no server file changed for localization', () => {
  // Req 5.4, 10.7, 11.4 — no localization import reaches into the server

  it('no i18n source file imports from apps/server', () => {
    const i18nDir = resolve(__dirname);
    const files = readdirSync(i18nDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx')
    );

    for (const file of files) {
      // Skip test files for import checks — they may import test utilities
      if (file.includes('.test.')) continue;
      const src = readFileSync(resolve(i18nDir, file), 'utf-8');
      expect(
        /apps\/server/.test(src),
        `${file} should not reference apps/server`
      ).toBe(false);
    }
  });

  it('LanguageSelector does not reference apps/server', () => {
    const src = readSrc('components/LanguageSelector.tsx');
    expect(/apps\/server/.test(src), 'LanguageSelector should not reference apps/server').toBe(false);
  });
});
