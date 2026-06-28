# Requirements Document

## Introduction

This feature closes the largest open block in the f-Socials roadmap (§8 "UI/UX recommendations", with the light borrowings from §6). The live report page (`app/apps/web/src/components/Report.tsx`) is already functional and schema-correct: it renders a TLDR, an always-visible issue-frame chart, an always-visible "most important framing signal" card, four tabs (Claim Ledger, Framing Signals, Useful Context, Other Angles), per-claim expandable drawers with source-tier chips, and a focus-trapped dispute modal.

The gap to "accessible and inclusive for a diverse, non-technical audience" is **progressive disclosure and reduced cognitive load, not a redesign**. This feature re-presents data the report already contains: it leads with a TLDR plus the single most important framing signal (soft amber underline) and moves everything else behind expandable drawers; it ports the prototype mockup's calmer card styling and "Why included" / "Why this is here" rationale blocks onto the live wiring; and it adds the three lens-aligned borrowings — a descriptive "covered from one angle" note (Ground News blindspot), spatial issue-frame chips (AllSides), and source-tier chips on citations (NewsGuard).

The compass holds throughout: **f-Socials is a lens, not a judge.** This is a presentation-layer feature only. It must not change the report schema, must not change the invariant gate's `ready` / `needs_review` decision, must never display a verdict on the truthfulness of content, and must never attach a reliability rating to a creator. Source-reliability tiers attach to sources and citations only.

## Glossary

- **Report_View**: The live React report page component (`Report.tsx`) that renders an `AnalysisReport` into the browser. It is the system under specification.
- **Summary_Lead**: The above-the-fold block that renders expanded on first paint, consisting of the report TLDR and the Most_Important_Framing_Signal.
- **Most_Important_Framing_Signal**: The framing signal with the highest severity; when several signals share the highest severity, the first such signal in report order. (Matches the existing `topFramingSignal` rule.)
- **Disclosure_Drawer**: An expandable/collapsible region (the live app's existing drawer pattern) that hides supporting detail until a reader opts to reveal it.
- **Rationale_Block**: A short, plain-language explanation attached to a card, labeled "Why included" (perspectives) or "Why this is here" (framing/claims), drawn only from fields already present in the report.
- **Coverage_Angle_Note**: A descriptive "covered from one angle" note shown on the Other Angles section, derived from the report's existing issue-frame position.
- **Issue_Frame_Chip**: A descriptive, spatial chip showing an issue-frame label or axis position (AllSides-style), never a verdict.
- **Source_Tier_Chip**: A reliability-tier chip attached to a cited source or perspective source (NewsGuard-style), never to a creator.
- **Creator**: The person or channel that produced the analyzed content.
- **Invariant_Gate**: The readiness gate in `app/apps/server/src/core/assemble.ts` that sets a report's status to `ready` or `needs_review`. It is verified, never weakened, and is out of scope for this presentation-layer feature.
- **AnalysisReport**: The report data contract (`app/apps/web/src/api/types.ts`) the Report_View renders.

## Requirements

### Requirement 1: Progressive disclosure lead

**User Story:** As a non-technical reader, I want one clear summary with the single most important framing signal up front, so that I grasp the gist without facing a wall of tabs, tiers, and colors.

#### Acceptance Criteria

1. WHEN a report carrying a TLDR with at least one non-whitespace character is rendered, THE Report_View SHALL display the TLDR text within the Summary_Lead expanded before any user interaction occurs.
2. WHEN a report contains at least one framing signal, THE Report_View SHALL display the Most_Important_Framing_Signal within the Summary_Lead expanded before any user interaction occurs.
3. THE Report_View SHALL select the Most_Important_Framing_Signal as the framing signal with the highest severity value in the report data, breaking a tie by choosing the first such signal in report-data order.
4. WHERE the Most_Important_Framing_Signal is displayed in the Summary_Lead, THE Report_View SHALL render a soft amber underline on the signal together with a visible adjacent text label identifying it as the most important framing signal, so that the signal is distinguishable without relying on the underline color.
5. WHEN a report is rendered, THE Report_View SHALL keep every report section other than the Summary_Lead collapsed before any user interaction occurs.
6. IF a report contains no framing signals AND carries a TLDR with at least one non-whitespace character, THEN THE Report_View SHALL render the Summary_Lead with the TLDR and SHALL omit the framing-signal portion of the Summary_Lead.
7. IF a report carries no TLDR with a non-whitespace character AND contains at least one framing signal, THEN THE Report_View SHALL render the Summary_Lead with the Most_Important_Framing_Signal and SHALL omit the TLDR portion.
8. IF a report carries no TLDR with a non-whitespace character AND contains no framing signals, THEN THE Report_View SHALL render the Summary_Lead with an honest "no summary available" statement, SHALL omit both the TLDR and framing-signal portions, and SHALL keep every other report section collapsed.

### Requirement 2: Expandable disclosure drawers

**User Story:** As a reader who wants to dig deeper, I want every supporting detail behind a clearly labeled "show me why" control, so that I can reveal only the parts I care about.

#### Acceptance Criteria

1. THE Report_View SHALL present each supporting section — the claim ledger, framing detail, useful context, other angles, and the issue-frame position — within a Disclosure_Drawer whose content is hidden and not displayed on first paint.
2. WHEN a reader activates a collapsed Disclosure_Drawer's control by pointer click or by keyboard, THE Report_View SHALL expand that drawer so its content becomes displayed.
3. WHEN a reader activates an expanded Disclosure_Drawer's control by pointer click or by keyboard, THE Report_View SHALL collapse that drawer so its content becomes hidden and not displayed.
4. THE Report_View SHALL render every Disclosure_Drawer control as reachable by keyboard Tab navigation and operable by both the Enter key and the Space key, with each key toggling the focused control's drawer between expanded and collapsed.
5. THE Report_View SHALL set the `aria-expanded` attribute on each Disclosure_Drawer control to `true` while that drawer is expanded and to `false` while that drawer is collapsed.
6. WHEN a reader expands a Disclosure_Drawer and then collapses it, THE Report_View SHALL hide that drawer's content and set its control's `aria-expanded` to `false`, returning the drawer to the same collapsed state it held on first paint.
7. WHEN a reader toggles one Disclosure_Drawer, THE Report_View SHALL leave the expanded or collapsed state of every other Disclosure_Drawer unchanged.

### Requirement 3: Rationale blocks ported from the mockup

**User Story:** As a reader, I want a short plain-language reason for why each evidence item and perspective is shown, so that the report reads as descriptive rather than arbitrary.

#### Acceptance Criteria

1. WHERE a perspective link carries a non-empty `whyIncluded` value, THE Report_View SHALL display that value as a Rationale_Block labeled "Why included" on the perspective card.
2. WHERE a claim carries a non-empty evidence description, WHILE that claim's Disclosure_Drawer is expanded, THE Report_View SHALL display the evidence description as a Rationale_Block labeled "Why this is here" using only fields already present in the report.
3. WHERE a claim carries a non-empty source basis and carries no non-empty evidence description, WHILE that claim's Disclosure_Drawer is expanded, THE Report_View SHALL display the source basis as a Rationale_Block labeled "Why this is here" using only fields already present in the report.
4. THE Report_View SHALL render each Rationale_Block using the unaltered text of its source field in the report, and SHALL NOT add, append, or substitute any wording that states a verdict on the truthfulness of the content or a reliability rating tied to the Creator.
5. IF a card's corresponding rationale field is absent, empty, or contains only whitespace, THEN THE Report_View SHALL omit the Rationale_Block for that card and SHALL NOT display placeholder text.

### Requirement 4: Covered-from-one-angle note (Ground News blindspot, mapped to the lens)

**User Story:** As a reader, I want a descriptive note when the content presents a topic from a single angle, so that I am prompted to seek other perspectives without being told the content is wrong.

#### Acceptance Criteria

1. WHEN a report is rendered AND the report's issue-frame position has at least one axis with magnitude greater than 0.8, THE Report_View SHALL display a Coverage_Angle_Note on the Other Angles section that descriptively states the content is covered from one angle and names the pole of every axis whose magnitude is greater than 0.8.
2. WHEN a report is rendered AND every axis of the report's issue-frame position has magnitude at most 0.8, THE Report_View SHALL omit the Coverage_Angle_Note.
3. WHERE the Coverage_Angle_Note is displayed, THE Report_View SHALL phrase it descriptively, SHALL NOT assert that the content is false, inaccurate, or wrong, SHALL NOT phrase it as a verdict, and SHALL NOT attach a reliability rating or label to the Creator.
4. IF the report carries no issue-frame position, THEN THE Report_View SHALL omit the Coverage_Angle_Note.
5. WHERE the Coverage_Angle_Note is displayed AND the report contains one or more perspective links, THE Report_View SHALL direct the reader to the available other-angle perspectives.
6. WHERE the Coverage_Angle_Note is displayed AND the report contains no perspective links, THE Report_View SHALL present the Coverage_Angle_Note without a directive to other-angle perspectives.

### Requirement 5: Spatial issue-frame chips (AllSides, descriptive)

**User Story:** As a reader, I want to see where the content and its perspectives sit on issue frames as spatial chips, so that I understand their framing without any of it being labeled right or wrong.

#### Acceptance Criteria

1. WHERE a report carries a non-empty issue-frame label, THE Report_View SHALL display that label as a descriptive Issue_Frame_Chip, rendering up to 120 characters of the label with ellipsis truncation beyond that and revealing the full label on hover or keyboard focus.
2. IF a report carries no issue-frame label, THEN THE Report_View SHALL omit the report-level Issue_Frame_Chip and SHALL NOT render a placeholder marker in its place.
3. WHERE a perspective link carries a non-empty `issueFrameLabel`, THE Report_View SHALL display that label as an Issue_Frame_Chip on the perspective card, rendering up to 120 characters of the label with ellipsis truncation beyond that and revealing the full label on hover or keyboard focus.
4. IF a perspective link carries no `issueFrameLabel`, THEN THE Report_View SHALL omit the Issue_Frame_Chip for that perspective and SHALL NOT render a placeholder marker in its place.
5. THE Report_View SHALL render the issue-frame position so that each axis position is fully determinable from a text description alone, independent of any spatial marker placement, color, or coordinate.
6. IF an axis's text description cannot be rendered, THEN THE Report_View SHALL omit the spatial marker for that axis so that the position is never conveyed by marker placement alone.
7. THE Report_View SHALL present every Issue_Frame_Chip as a descriptive position and SHALL NOT present it as a verdict, a truthfulness rating, a source-reliability rating, a ranking, or a numeric score.

### Requirement 6: Source-tier chip in citations (NewsGuard, sources only)

**User Story:** As a reader, I want a reliability tier on each cited source so that I can weigh the evidence, while trusting that no such rating is ever placed on a creator.

#### Acceptance Criteria

1. WHERE a citation carries a source tier, THE Report_View SHALL display a Source_Tier_Chip on that citation showing the human-readable text label for that tier rather than the internal tier identifier.
2. WHERE a perspective link carries a source tier, THE Report_View SHALL display a Source_Tier_Chip on that perspective showing the human-readable text label for that tier rather than the internal tier identifier.
3. THE Report_View SHALL attach Source_Tier_Chips only to cited sources and perspective sources and SHALL NOT attach any tier, reliability label, or other source rating to the Creator.
4. THE Report_View SHALL render each Source_Tier_Chip with a visible text label adjacent to any color indicator and SHALL convey the tier through that text label, never by color alone.
5. IF a citation or a perspective link does not carry a source tier, THEN THE Report_View SHALL omit the Source_Tier_Chip for that item and SHALL NOT display a placeholder or empty chip in its place.

### Requirement 7: Accessibility and responsive layout

**User Story:** As a reader using assistive technology or a small screen, I want full keyboard and screen-reader access to the progressive disclosure, so that the report is usable by a diverse audience.

#### Acceptance Criteria

1. THE Report_View SHALL render a visible text label immediately adjacent to every color-coded signal, including severity tags, evidence-strength chips, source-tier chips, and the Summary_Lead amber underline, so that each signal's meaning is conveyed by text and not by color alone.
2. THE Report_View SHALL make every tab control and every Disclosure_Drawer control reachable using the Tab key and activatable using both the Enter key and the Space key.
3. WHEN a tab control or a Disclosure_Drawer control receives keyboard focus, THE Report_View SHALL render a visible focus indicator on that control.
4. WHEN a modal is open, THE Report_View SHALL confine keyboard focus within that modal so that the Tab key and Shift+Tab cycle only through the modal's focusable controls and never reach controls outside the modal.
5. WHEN a modal is closed, THE Report_View SHALL move keyboard focus to the control that opened it.
6. WHILE the viewport width is at most 768 pixels, THE Report_View SHALL present all report content in a single column with no horizontal scrolling of report content.
7. THE Report_View SHALL set the `aria-expanded` attribute on every disclosure control to reflect that control's current expanded or collapsed state.
8. THE Report_View SHALL set the `aria-pressed` attribute on every tab control to reflect that tab's current selected or unselected state.
9. THE Report_View SHALL use the muted teal `#0d9488` as the single accent color for interactive affordances and SHALL source its icons from the `lucide-react` library.

### Requirement 8: Neutrality and data integrity (lens, not judge)

**User Story:** As the product owner, I want the new presentation to change neither the report's data nor its decision and to never issue a verdict, so that the lens-not-judge compass and the invariant gate hold by construction.

#### Acceptance Criteria

1. THE Report_View SHALL re-present only data already present in the AnalysisReport, SHALL NOT mutate the received AnalysisReport object, and SHALL NOT add, remove, or rename any report schema field.
2. THE Report_View SHALL render a count of claims, framing signals, context cards, and perspectives that each equals the count of the corresponding collection in the report.
3. THE Report_View SHALL NOT display a verdict on the truthfulness of the analyzed content.
4. THE Report_View SHALL NOT display a reliability rating tied to the Creator.
5. THE Report_View SHALL NOT invoke or re-evaluate the Invariant_Gate, leaving the report's `status` and readiness decision unchanged.
6. WHEN a report has status `needs_review`, THE Report_View SHALL display the report with a visible text label indicating it is awaiting review and SHALL NOT hide or suppress any of the report's content.
7. WHEN a report has status `ready`, THE Report_View SHALL render the report's full content and SHALL NOT display a review notice.
