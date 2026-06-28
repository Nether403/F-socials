// Feature: progressive-disclosure-report-ui, Property 10: Source-tier labels are human-readable and never the raw identifier
// Validates: Requirements 6.1, 6.2
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { SourceTierChip } from './SourceTierChip';
import { TIER } from './reportView';
import type { SourceTier } from '../api/types';

// The four SourceTier identifiers — the input space for the tier label.
const tierArb = fc.constantFrom<SourceTier>(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
);

describe('Property 10: Source-tier labels are human-readable and never the raw identifier', () => {
  it('renders a non-empty label equal to TIER[tier] and never the internal identifier', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const { container } = render(<SourceTierChip tier={tier} />);
        try {
          const chip = container.querySelector('span.tag.muted');
          expect(chip).not.toBeNull();
          const rendered = chip!.textContent ?? '';
          // Human-readable: non-empty visible text.
          expect(rendered.trim().length).toBeGreaterThan(0);
          // It is exactly the shared TIER map label...
          expect(rendered).toBe(TIER[tier]);
          // ...and never the raw internal identifier (e.g. 'tier1_primary').
          expect(rendered).not.toBe(tier);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
