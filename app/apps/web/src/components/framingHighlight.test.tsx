// Feature: trust-and-launch-bundle, Property 12: Framing highlights expose a programmatic description (Validates: Requirements 4.8)
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';
import { LanguageProvider } from '../i18n/context';
import { Report } from './Report';
import type { AnalysisReport, FramingSignal } from '../api/types';

// Minimal report shell; the test fills in transcript + a single framing signal/example.
function makeReport(transcript: string, signal: FramingSignal): AnalysisReport {
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    transcript,
    claims: [],
    framingSignals: [signal],
    contextCards: [],
    perspectives: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe('Property 12: framing highlights expose a programmatic description', () => {
  it('every rendered framing highlight has an aria-describedby resolving to its explanation', () => {
    fc.assert(
      fc.property(
        fc.string(), // prefix (may be empty)
        fc.string({ minLength: 1 }), // quote — must be non-empty so endIndex > startIndex
        fc.string(), // suffix (may be empty)
        fc.string({ minLength: 1 }), // explanation — non-empty
        (prefix, quote, suffix, explanation) => {
          const transcript = prefix + quote + suffix;
          const startIndex = prefix.length;
          const endIndex = startIndex + quote.length;
          const signal: FramingSignal = {
            technique: 'Test technique',
            severity: 'low',
            description: 'A framing signal under test.',
            examples: [{ text: quote, explanation, startIndex, endIndex }],
          };

          render(<LanguageProvider><Report report={makeReport(transcript, signal)} onBack={() => {}} /></LanguageProvider>);
          try {
            // Move to the Framing tab so the transcript (with highlights) renders.
            fireEvent.click(screen.getByRole('button', { name: /framing signals/i }));

            const mark = document.querySelector('mark');
            expect(mark).not.toBeNull();

            const descId = mark!.getAttribute('aria-describedby');
            expect(descId).toBeTruthy();

            const desc = document.getElementById(descId!);
            expect(desc).not.toBeNull();
            expect(desc!.textContent).toBe(explanation);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 30000); // 100 full <Report> renders need more than the 5s default.
});
