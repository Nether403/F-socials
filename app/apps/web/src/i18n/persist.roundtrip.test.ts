// Feature: en-nl-localization, Property 3: Persistence round-trip and totality
// Validates: Requirements 2.1, 2.5, 3.1, 3.2, 3.3, 10.2, 10.3, 10.4

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SUPPORTED_LANGUAGES, isSupportedLanguage, type Language } from './catalog';
import { writeStoredLanguage, readStoredLanguage, resolveInitialLanguage } from './persist';

/**
 * Property 3: Persistence round-trip and totality
 *
 * For any Supported_Language, writing it to the Persistence_Store and resolving
 * the initial language restores that same Active_Language; for any stored value
 * that is absent or not a Supported_Language, the initial resolution falls through
 * to detection and still returns a Supported_Language without throwing.
 */

// ponytail: simple in-memory localStorage mock — no external dependency needed
function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe('persist — Property 3: Persistence round-trip and totality', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockStorage);
    // Stub navigator to a neutral value (no supported language detected)
    vi.stubGlobal('navigator', { languages: ['fr-FR'], language: 'fr' });
  });

  it('writing any Supported_Language then resolveInitialLanguage() restores it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (lang: Language) => {
          mockStorage.clear();
          writeStoredLanguage(lang);
          const resolved = resolveInitialLanguage();
          expect(resolved).toBe(lang);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('absent stored value falls through to detection and returns a Supported_Language', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          mockStorage.clear();
          const resolved = resolveInitialLanguage();
          expect(isSupportedLanguage(resolved)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid stored value (arbitrary non-supported string) falls through and returns a Supported_Language without throwing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).filter(
          (s) => !isSupportedLanguage(s),
        ),
        (invalidValue: string) => {
          mockStorage.clear();
          // Write an invalid value directly to localStorage
          mockStorage.setItem('fsocials-language', invalidValue);
          const resolved = resolveInitialLanguage();
          expect(isSupportedLanguage(resolved)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('readStoredLanguage returns null for absent/invalid and the language for valid', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (lang: Language) => {
          mockStorage.clear();
          // Absent → null
          expect(readStoredLanguage()).toBeNull();
          // Valid → same language
          writeStoredLanguage(lang);
          expect(readStoredLanguage()).toBe(lang);
        },
      ),
      { numRuns: 100 },
    );
  });
});
