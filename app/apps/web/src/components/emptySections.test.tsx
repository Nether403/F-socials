// Feature: trust-and-launch-bundle, Property 10: A section with no items shows an
// empty state while other sections render (Validates: Requirements 4.1)
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import type { AnalysisReport } from '../api/types';

// Identifying text for a populated item in each section, plus its empty-state message.
// The item text is what proves the section rendered its contents when active.
const SECTIONS = {
  claims: {
    tab: /Claim Ledger/,
    empty: 'No claims were extracted.',
    item: 'Generated claim text',
  },
  framing: {
    tab: /Framing Signals/,
    empty: 'No framing signals detected.',
    item: 'Loaded language',
  },
  context: {
    tab: /Useful Context/,
    empty: 'No notable omissions flagged.',
    item: 'Generated context title',
  },
  perspectives: {
    tab: /Other Angles/,
    empty: 'No bridging perspectives found.',
    item: 'Generated bridging source',
  },
} as const;

// Build a ready report where each section's array is populated or empty per the flags.
function buildReport(flags: Record<keyof typeof SECTIONS, boolean>): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    transcript: 'A short transcript used when framing signals render.',
    claims: flags.claims
      ? []
      : [
          {
            id: 'c1',
            claimText: SECTIONS.claims.item,
            verifiability: 'verifiable',
            evidenceStrength: 'none',
            confidence: 0.5,
            citations: [],
          },
        ],
    framingSignals: flags.framing
      ? []
      : [{ technique: SECTIONS.framing.item, severity: 'low', description: 'desc', examples: [] }],
    contextCards: flags.context ? [] : [{ title: SECTIONS.context.item, description: 'desc' }],
    perspectives: flags.perspectives
      ? []
      : [
          {
            url: 'https://example.com',
            sourceName: SECTIONS.perspectives.item,
            sourceTier: 'tier2_institutional',
            issueFrameLabel: 'Frame',
            divergence: 0.5,
            dehumanization: 0,
          },
        ],
    createdAt: now,
    updatedAt: now,
  };
}

describe('Property 10: empty section shows an empty state while siblings render', () => {
  it('each section independently shows its empty state when empty, or its items when populated', () => {
    fc.assert(
      fc.property(
        fc.record({
          claims: fc.boolean(),
          framing: fc.boolean(),
          context: fc.boolean(),
          perspectives: fc.boolean(),
        }),
        (flags) => {
          render(<Report report={buildReport(flags)} onBack={() => {}} />);
          try {
            for (const key of Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]) {
              const { tab, empty, item } = SECTIONS[key];
              // Activate this section's tab so only its content is shown.
              fireEvent.click(screen.getByRole('button', { name: tab }));

              if (flags[key]) {
                // Empty section: its empty-state message is shown and no items render.
                expect(screen.getByText(empty)).toBeInTheDocument();
                expect(screen.queryAllByText(item)).toHaveLength(0);
              } else {
                // Populated section: at least one item renders, no empty message.
                expect(screen.queryAllByText(item).length).toBeGreaterThan(0);
                expect(screen.queryByText(empty)).not.toBeInTheDocument();
              }
            }
          } finally {
            // fast-check reuses the DOM across runs; reset between iterations.
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000); // 100 full renders + tab clicks runs well past the 5s default.
});
