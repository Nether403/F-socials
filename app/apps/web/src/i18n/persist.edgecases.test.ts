import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeStoredLanguage, readStoredLanguage } from './persist';

// Feature: en-nl-localization, Edge-case: Storage rejection
// Validates: Requirements 3.4

describe('persist – storage rejection edge cases', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError: access denied'); },
      setItem: () => { throw new Error('QuotaExceededError: storage full'); },
      removeItem: () => { throw new Error('SecurityError: access denied'); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writeStoredLanguage does not throw when localStorage rejects writes', () => {
    expect(() => writeStoredLanguage('nl')).not.toThrow();
  });

  it('writeStoredLanguage does not persist the value (storage rejected it)', () => {
    writeStoredLanguage('nl');
    // The language was NOT actually stored since setItem threw
    const stored = readStoredLanguage();
    expect(stored).toBeNull();
  });

  it('readStoredLanguage returns null when localStorage.getItem throws', () => {
    const result = readStoredLanguage();
    expect(result).toBeNull();
  });
});
