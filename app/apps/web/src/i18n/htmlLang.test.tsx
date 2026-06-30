// Feature: en-nl-localization, Property 9: Document language reflects Active_Language
// Validates: Requirements 8.4

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, act } from '@testing-library/react';
import { LanguageProvider, useT } from './context';
import { SUPPORTED_LANGUAGES, type Language } from './catalog';

// ponytail: simple in-memory localStorage mock — matches pattern from persist tests
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

/**
 * Test component that exposes setLanguage via a button for each supported language.
 */
function LangSetter() {
  const { setLanguage } = useT();
  return (
    <>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button key={lang} data-testid={`set-${lang}`} onClick={() => setLanguage(lang)}>
          {lang}
        </button>
      ))}
    </>
  );
}

describe('Property 9: Document language reflects Active_Language', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockStorage);
    document.documentElement.lang = '';
  });

  afterEach(() => {
    document.documentElement.lang = '';
    vi.unstubAllGlobals();
  });

  it('setting the Active_Language sets <html lang> to the primary subtag of that language', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LANGUAGES),
        (lang: Language) => {
          // Reset between iterations
          mockStorage.clear();
          document.documentElement.lang = '';

          const { getByTestId, unmount } = render(
            <LanguageProvider>
              <LangSetter />
            </LanguageProvider>,
          );

          act(() => {
            getByTestId(`set-${lang}`).click();
          });

          // The primary subtag for 'en' is 'en', for 'nl' is 'nl'
          const expectedSubtag = lang.split('-')[0];
          expect(document.documentElement.lang).toBe(expectedSubtag);

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
