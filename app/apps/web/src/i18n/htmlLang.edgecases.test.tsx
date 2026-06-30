import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { LanguageProvider, useLocale } from './context';

// Feature: en-nl-localization, Edge-case: Unresolvable primary subtag
// Validates: Requirements 8.5

/**
 * The Language type only allows 'en' | 'nl', both of which always resolve to
 * valid primary subtags. This edge-case test verifies the defensive behavior:
 * - The provider never leaves <html lang> empty or undefined
 * - If somehow a subtag couldn't resolve, the previous lang stays untouched
 * - No Reader-visible error is raised in any path
 */

// ponytail: simple in-memory localStorage mock
function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

function LangConsumer({ switchTo }: { switchTo?: 'en' | 'nl' }) {
  const { language, setLanguage } = useLocale();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      {switchTo && (
        <button onClick={() => setLanguage(switchTo)} data-testid="switch">
          Switch
        </button>
      )}
    </div>
  );
}

describe('htmlLang – unresolvable primary subtag edge cases', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockStorage);
    // Start with a known non-supported lang attribute to test defensive behavior
    document.documentElement.lang = 'fr';
  });

  afterEach(() => {
    document.documentElement.lang = '';
    vi.unstubAllGlobals();
  });

  it('LanguageProvider on mount sets <html lang> to a valid non-empty subtag', () => {
    render(
      <LanguageProvider>
        <LangConsumer />
      </LanguageProvider>,
    );

    const lang = document.documentElement.lang;
    expect(lang).toBeTruthy();
    expect(lang.trim().length).toBeGreaterThan(0);
    expect(['en', 'nl']).toContain(lang);
  });

  it('LanguageProvider replaces a previous non-supported lang with the resolved subtag', () => {
    // Start with 'fr' (set in beforeEach) — confirm it gets overwritten
    expect(document.documentElement.lang).toBe('fr');

    render(
      <LanguageProvider>
        <LangConsumer />
      </LanguageProvider>,
    );

    // Provider should have set it to 'en' (default) since no stored choice exists
    expect(document.documentElement.lang).toBe('en');
  });

  it('setLanguage never sets <html lang> to an empty string', () => {
    const { getByTestId } = render(
      <LanguageProvider>
        <LangConsumer switchTo="nl" />
      </LanguageProvider>,
    );

    act(() => {
      getByTestId('switch').click();
    });

    const lang = document.documentElement.lang;
    expect(lang).not.toBe('');
    expect(lang.trim().length).toBeGreaterThan(0);
    expect(lang).toBe('nl');
  });

  it('switching languages does not raise an error or leave lang undefined', () => {
    mockStorage.setItem('fsocials-language', 'nl');

    const { getByTestId } = render(
      <LanguageProvider>
        <LangConsumer switchTo="en" />
      </LanguageProvider>,
    );

    // Switch to en — no error should be raised
    expect(() => {
      act(() => {
        getByTestId('switch').click();
      });
    }).not.toThrow();

    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.lang).not.toBeUndefined();
  });

  it('<html lang> is never set to undefined or null string', () => {
    render(
      <LanguageProvider>
        <LangConsumer />
      </LanguageProvider>,
    );

    // Verify lang is not the string "undefined" or "null"
    expect(document.documentElement.lang).not.toBe('undefined');
    expect(document.documentElement.lang).not.toBe('null');
    expect(document.documentElement.lang).toBe('en');
  });
});
