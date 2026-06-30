// Feature: en-nl-localization, Property 4: Switch idempotence
// Validates: Requirements 1.5

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { render, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { LanguageProvider, useT } from './context';
import type { Language } from './catalog';

const SUPPORTED_LANGUAGES: Language[] = ['en', 'nl'];

/**
 * Test harness that:
 * 1. Sets the language to `target` on mount
 * 2. Exposes a `triggerIdempotentSet` callback via ref so the test can
 *    call setLanguage(current) after the initial render stabilizes
 */
function Harness({
  target,
  onReady,
}: {
  target: Language;
  onReady: (helpers: { getHeading: () => string; setLanguageAgain: () => void }) => void;
}) {
  const { language, setLanguage, t } = useT();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setLanguage(target);
    }
  }, [target, setLanguage]);

  useEffect(() => {
    if (language === target && initialized.current) {
      onReady({
        getHeading: () => t('home.heading'),
        setLanguageAgain: () => setLanguage(target),
      });
    }
  });

  return <span data-testid="heading">{t('home.heading')}</span>;
}

describe('Property 4: Switch idempotence', () => {
  it('setting Active_Language to its current value leaves rendered UI_Chrome unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SUPPORTED_LANGUAGES), (lang) => {
        let helpers: { getHeading: () => string; setLanguageAgain: () => void } | null =
          null;

        const { getByTestId, unmount } = render(
          <LanguageProvider>
            <Harness
              target={lang}
              onReady={(h) => {
                helpers = h;
              }}
            />
          </LanguageProvider>,
        );

        // After render, helpers should be populated
        expect(helpers).not.toBeNull();

        // Capture the rendered text before idempotent set
        const textBefore = getByTestId('heading').textContent;

        // Call setLanguage with the same value (idempotent operation)
        act(() => {
          helpers!.setLanguageAgain();
        });

        // Capture the rendered text after idempotent set
        const textAfter = getByTestId('heading').textContent;

        // The UI_Chrome must be unchanged
        expect(textAfter).toBe(textBefore);
        // And it must be non-empty (sanity)
        expect(textAfter!.trim().length).toBeGreaterThan(0);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
