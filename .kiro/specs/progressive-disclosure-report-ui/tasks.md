# Implementation Plan: Progressive Disclosure Report UI

## Overview

This is a presentation-layer change to `app/apps/web/src/components/Report.tsx`: it reorganizes data the page already renders into a leading `SummaryLead` plus independent, keyboard-operable disclosure drawers, and ports the calmer card styling, rationale blocks, coverage-angle note, and spatial/source-tier chips onto the live wiring.

The build runs bottom-up so each step is verifiable in isolation before integration: pure view-model helpers first, then the presentational leaf components and the reusable `DisclosureSection`, then the `SummaryLead`, then the integration into `Report.tsx` that replaces the four-tab switcher with a stack of independent drawers, and finally the full-render property and example tests. No new dependency is added; helpers reuse the existing `topFramingSignal`, `issueFrameAxisText`, and `TIER` already in the codebase. The report schema, the API client, and the invariant gate are never touched.

Web tests run under Vitest + React Testing Library with `npx vitest run` (single run, never watch); the type gate is `tsc -b` in `apps/web`. Every property test carries the header `// Feature: progressive-disclosure-report-ui, Property <n>: <description>` plus a `Validates: Requirements …` line and runs `fast-check` at a minimum of 100 runs.

## Tasks

- [x] 1. Add pure view-model helpers
  - [x] 1.1 Implement the new pure helpers in a shared module
    - Create `app/apps/web/src/components/reportView.ts` exporting `claimRationale(claim)` (`evidenceDescription` when non-whitespace, else `sourceBasis` when non-whitespace, else `undefined`), `strongAxisPoles(issueFrame)` (pole name per axis with `|value| > 0.8`, correct pole for each axis sign; empty when none), `truncateLabel(label, max=120)` (`{ shown, truncated }`, ellipsis only when input exceeds 120, full label preserved), and `sectionCounts(report)` (each value equals the corresponding collection length)
    - Reuse the existing `topFramingSignal`, `issueFrameAxisText`, and `TIER` from `Report.tsx` — export them from there or re-export so components and tests share one source; do not duplicate the logic
    - _Requirements: 3.2, 3.3, 3.5, 4.1, 4.2, 5.1, 5.3, 8.2_

  - [x] 1.2 Write property test for `truncateLabel`
    - File `app/apps/web/src/components/reportView.truncate.test.tsx`
    - **Property 8: Issue-frame chip truncation preserves the full label**
    - **Validates: Requirements 5.1, 5.3**

- [x] 2. Build presentational leaf components
  - [x] 2.1 Implement `SourceTierChip`
    - Create `app/apps/web/src/components/SourceTierChip.tsx`; returns `null` when `tier` is absent or outside the `SourceTier` union; otherwise renders the human-readable `TIER` label (never the internal id) with a visible text label adjacent to any color indicator
    - Attach only to citations and perspective sources; never creator-scoped
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 7.1_

  - [x] 2.2 Write property test for source-tier labels
    - File `app/apps/web/src/components/sourceTierChip.test.tsx`
    - **Property 10: Source-tier labels are human-readable and never the raw identifier**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 2.3 Implement `IssueFrameChip`
    - Create `app/apps/web/src/components/IssueFrameChip.tsx`; returns `null` when `label` is absent/empty; otherwise renders `truncateLabel(label, 120)`, exposing the full label via `title` (hover) and keyboard focus when truncated; presented as a descriptive position chip, never a verdict, rating, ranking, or score
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

  - [x] 2.4 Implement `RationaleBlock`
    - Create `app/apps/web/src/components/RationaleBlock.tsx`; returns `null` when `text` is absent/empty/whitespace-only (no placeholder); otherwise renders the unaltered field text under the given `'Why included' | 'Why this is here'` label, adding no prefix, suffix, verdict, or creator rating
    - _Requirements: 3.1, 3.4, 3.5_

  - [x] 2.5 Write property test for verbatim rationale rendering
    - File `app/apps/web/src/components/rationaleBlock.test.tsx`
    - **Property 6: Rationale blocks render the source field verbatim**
    - **Validates: Requirements 3.4**

  - [x] 2.6 Write property test for claim rationale precedence and omission
    - File `app/apps/web/src/components/reportView.rationale.test.tsx`; assert `claimRationale` evidence→source precedence and that `RationaleBlock` renders no node for an `undefined`/whitespace-only value
    - **Property 5: Claim rationale follows the evidence→source precedence and omits on absence**
    - **Validates: Requirements 3.2, 3.3, 3.5**

  - [x] 2.7 Implement `CoverageAngleNote`
    - Create `app/apps/web/src/components/CoverageAngleNote.tsx`; returns `null` when `issueFrame` is absent or no axis exceeds 0.8; otherwise renders the fixed descriptive copy naming the poles from `strongAxisPoles`, never a verdict and never a creator rating; appends the perspectives directive only when `hasPerspectives` is true
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.8 Write property test for the coverage-angle note trigger and poles
    - File `app/apps/web/src/components/coverageAngleNote.test.tsx`; assert `strongAxisPoles` output and that the note renders exactly when a strong axis exists and is omitted otherwise (including no issue-frame)
    - **Property 7: Coverage-angle note triggers exactly on a strong axis and names its poles**
    - **Validates: Requirements 4.1, 4.2, 4.4**

- [x] 3. Build the reusable `DisclosureSection` wrapper
  - [x] 3.1 Implement `DisclosureSection`
    - Create `app/apps/web/src/components/DisclosureSection.tsx` extracted from the existing `ClaimCard` head pattern; control has `role="button"`, `tabIndex={0}`, toggles `open` on click and on Enter/Space (with `preventDefault`), sets `aria-expanded` to match `open`, renders children only while `open` (removed from DOM when collapsed), shows a rotating `lucide-react` `ChevronDown` and a `:focus-visible` ring in `--accent`; `defaultOpen` defaults to `false`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.2, 7.3, 7.7_

  - [x] 3.2 Write property test for drawer expand→collapse round-trip
    - File `app/apps/web/src/components/disclosureSection.roundtrip.test.tsx`
    - **Property 3: Expand-then-collapse round-trips a drawer to its first-paint state**
    - **Validates: Requirements 2.3, 2.6**

  - [x] 3.3 Write interaction tests for the disclosure control
    - File `app/apps/web/src/components/disclosureSection.interaction.test.tsx`; expand/collapse via click and via Enter and Space, `aria-expanded` reflection, Tab-reachability, and a visible focus indicator
    - _Requirements: 2.2, 2.4, 2.5, 7.2, 7.3, 7.7_

- [x] 4. Build the `SummaryLead`
  - [x] 4.1 Implement `SummaryLead`
    - Create `app/apps/web/src/components/SummaryLead.tsx`, rendered expanded above all drawers before any interaction; render TLDR only when `report.tldr?.trim()` is truthy, render the most-important framing signal (via existing `topFramingSignal`) with a soft amber underline plus an adjacent text label, and render the honest "No summary available for this analysis." statement when neither portion applies
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 7.1_

  - [x] 4.2 Write property test for most-important framing signal selection
    - File `app/apps/web/src/components/summaryLead.topSignal.test.tsx`
    - **Property 1: Most-important framing signal is the highest-severity, earliest-on-tie signal**
    - **Validates: Requirements 1.2, 1.3**

  - [x] 4.3 Write example tests for `SummaryLead` branches
    - File `app/apps/web/src/components/summaryLead.test.tsx`; first-paint TLDR + signal content, amber underline with adjacent label, TLDR-only, signal-only, and no-summary branches
    - _Requirements: 1.1, 1.4, 1.6, 1.7, 1.8_

- [x] 5. Integrate components into `Report.tsx`
  - [x] 5.1 Replace the four-tab switcher with the disclosure-drawer layout and wire all components
    - In `app/apps/web/src/components/Report.tsx`: remove the mutually-exclusive `tab` state and render `SummaryLead` followed by five independent `DisclosureSection` wrappers (Claim Ledger, Framing Signals, Useful Context, Other Angles, Issue-Frame Position), each surfacing its `sectionCounts` value; mount `RationaleBlock` (perspective `whyIncluded` and claim `claimRationale`), `CoverageAngleNote`, `IssueFrameChip` (report-level and per perspective), and `SourceTierChip` (citations and perspective sources) at their existing data sites
    - Keep the header counts row, the `needs_review` text banner / no-notice-when-`ready` behavior, the framing-signal selector's `aria-pressed`, the existing `DisputeModal` focus trap and `disputeOpenerRef` focus restore, and the `≤768px` single-column rule; read `report` immutably and write nothing back
    - _Requirements: 2.1, 2.7, 3.1, 3.2, 3.3, 4.5, 5.5, 6.1, 6.2, 6.3, 7.4, 7.5, 7.6, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 6. Checkpoint - Ensure all tests pass
  - Run `npx vitest run` and `tsc -b` in `app/apps/web`; ask the user if questions arise.

- [x] 7. Full-render property and example tests
  - [x] 7.1 Write property test for first-paint collapsed state
    - File `app/apps/web/src/components/report.firstPaint.test.tsx`; render a generated report with no interaction, assert every drawer control reports `aria-expanded="false"`, no supporting section content is in the DOM, and `SummaryLead` is expanded
    - **Property 2: Every supporting section is collapsed on first paint**
    - **Validates: Requirements 1.5, 2.1**

  - [x] 7.2 Write property test for drawer independence
    - File `app/apps/web/src/components/report.independence.test.tsx`; toggling any single target drawer changes only that drawer's `aria-expanded` and content visibility, leaving all others unchanged
    - **Property 4: Toggling one drawer leaves every other drawer unchanged**
    - **Validates: Requirements 2.7**

  - [x] 7.3 Write property test for issue-frame axis text and marker omission
    - File `app/apps/web/src/components/report.issueFrame.test.tsx`; for any `x`/`y` (including out-of-range and non-finite), per-axis `issueFrameAxisText` is non-empty and a spatial marker renders only when its axis text is present
    - **Property 9: Every issue-frame position has text, and no marker renders without it**
    - **Validates: Requirements 5.5, 5.6**

  - [x] 7.4 Write property test for tier-chip placement
    - File `app/apps/web/src/components/report.tierChips.test.tsx`; rendered tier-chip count equals citations-with-tier plus perspectives-with-tier, and no tier chip appears in any creator- or header-scoped region
    - **Property 11: Tier chips attach only to sources, never to the creator**
    - **Validates: Requirements 6.3, 8.4**

  - [x] 7.5 Write property test for render immutability and status fidelity
    - File `app/apps/web/src/components/report.immutability.test.tsx`; rendering leaves the report deeply equal to a pre-render clone and the rendered status notice matches `report.status` with no gate re-evaluation
    - **Property 12: Rendering never mutates the report**
    - **Validates: Requirements 8.1, 8.5**

  - [x] 7.6 Write property test for section counts
    - File `app/apps/web/src/components/report.counts.test.tsx`; rendered counts for claims, framing signals, context cards, and perspectives each equal the corresponding collection length
    - **Property 13: Section counts equal their collection lengths**
    - **Validates: Requirements 8.2**

  - [x] 7.7 Write example tests for status, modal focus, color-never-alone, and responsive/theming smoke
    - File `app/apps/web/src/components/report.presentation.test.tsx`; `needs_review` shows the review label with all content intact and `ready` shows no notice; modal focus trap and focus restore to opener; adjacent text labels on chips and the amber underline; absence of verdict tokens in feature copy; `≤768px` single-column smoke and the teal `#0d9488` accent + `lucide-react` icon sourcing
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.9, 8.3, 8.6, 8.7_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Run `npx vitest run` and `tsc -b` in `app/apps/web`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability, and each property sub-task names its property number and the requirements clauses it validates.
- This feature adds no dependency and no schema field; helpers reuse the existing `topFramingSignal`, `issueFrameAxisText`, and `TIER`. The invariant gate is read (`report.status`) but never invoked or edited.
- Property tests use `fast-check` at a minimum of 100 runs and carry the required `// Feature: progressive-disclosure-report-ui, Property <n>: …` header.
- Checkpoints run `npx vitest run` and `tsc -b` in `app/apps/web` for incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3", "2.4", "2.7", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.5", "2.6", "2.8", "3.2", "3.3", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] }
  ]
}
```
