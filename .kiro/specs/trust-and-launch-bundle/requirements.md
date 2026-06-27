# Requirements Document

## Introduction

The trust-and-launch-bundle feature converts the already-working f-Socials analysis engine into something defensibly trustworthy and publicly shippable. It is the cohesive set of near-term P0/P1 launch-blocker items from the roadmap §4 ("shippable and trusted"): a transparency Methodology page, a credible source-tier reliability policy, dispute/flag intake, a UI polish and accessibility pass, and the production build/deploy hardening needed for safe public exposure.

The product compass governs every requirement: **f-Socials is a lens, not a judge.** The system surfaces framing and evidence to inoculate readers, never issues verdicts, and never labels creators. Source reliability chips attach to citations and sources only. The invariant gate in `core/assemble.ts` is a codified moat and MUST NOT be weakened by any item in this bundle: no claim may assert an evidence strength it cannot cite, and an honest `evidenceStrength: 'none'` with zero citations remains a valid served outcome.

This bundle delivers the intake surfaces for disputes and flags; the human review workflow is intentionally out of scope and may lag.

(The evidence-outcome vocabulary referenced by the Methodology_Page — directly matched fact-check, matched primary or institutional source, relevant context only, no sufficient evidence found, and not fact-checkable — is defined and made authoritative by the separate fact-check query-tuning work; this bundle describes those outcomes at a level that remains valid as that work lands, and does not itself specify the retrieval logic that produces them.)

## Glossary

- **f-Socials**: The content-analysis system that produces inspectable analysis reports from media inputs.
- **Analysis_Report**: The full report object for one analyzed content item, including claims, framing signals, context cards, perspectives, and provenance.
- **Methodology_Page**: A static, plain-language transparency page describing how scoring works, the source-tier policy, who reviews reports, and how to dispute.
- **Provenance_Footer**: The footer region of an Analysis_Report that displays model, analysis version, source policy version, review status, and dispute count.
- **Source_Tier_Policy**: The transparent, versioned tiered classification of source reliability seeded from open signals.
- **Source_Tier**: The reliability classification of a single source, one of `tier1_primary`, `tier2_institutional`, `tier3_viewpoint`, or `excluded`.
- **Open_Signal**: A freely and commercially usable reliability signal such as IFCN signatory lists, domain registries, or press-council membership.
- **Citation**: A source reference attached to a claim, carrying a source URL, source name, and Source_Tier.
- **Evidence_Outcome**: The qualitative result of checking a claim's evidence, one of: a directly matched fact-check, a matched primary or institutional source, relevant context without direct verification, no sufficient evidence found, or a claim that is not fact-checkable. The authoritative definition of this vocabulary is owned by the separate fact-check query-tuning work.
- **Source_Chip**: The UI element that displays a citation's Source_Tier and reliability label.
- **Dispute**: A user-submitted objection to an Analysis_Report or one of its claims, recorded in the `disputes` table.
- **Flag**: A user-submitted community signal that a framing technique is present, recorded in the `flags` table.
- **Dispute_Modal**: The report-page UI through which a user submits a Dispute.
- **API_Server**: The Hono/Express-style HTTP service at `app/apps/server` exposing analysis routes.
- **Worker**: The long-running BullMQ pipeline worker that processes queued analyses.
- **Web_App**: The React + Vite client at `app/apps/web` that renders the Analysis_Report.
- **Invariant_Gate**: The assembly check in `core/assemble.ts` that gates a report to `ready` or `needs_review`.
- **requireAuth**: The authentication middleware that rejects unauthenticated requests.
- **Rate_Limiter**: The per-key daily rate limiter applied to new (cache-miss) analyses.
- **WCAG_2.2_AA**: The Web Content Accessibility Guidelines version 2.2, conformance level AA.

## Requirements

### Requirement 1: Methodology Transparency Page

**User Story:** As a reader evaluating a shared report, I want a plain-language page explaining how f-Socials works, so that I can decide whether to trust the analysis.

#### Acceptance Criteria

1. THE Web_App SHALL serve a Methodology_Page at a single dedicated route without requiring authentication.
2. THE Methodology_Page SHALL describe how f-Socials distinguishes the possible Evidence_Outcome values for a claim — a directly matched fact-check, a matched primary or institutional source, relevant context without direct verification, no sufficient evidence found, and a claim that is not fact-checkable — and SHALL describe what raises or lowers confidence in a claim's evidence within that set of outcomes.
3. THE Methodology_Page SHALL describe the Source_Tier_Policy and the Open_Signals used to assign each Source_Tier.
4. THE Methodology_Page SHALL describe who reviews reports and the meaning of each defined review status.
5. THE Methodology_Page SHALL describe how a user submits a Dispute.
6. THE Methodology_Page SHALL display the current Source_Tier_Policy version identifier.
7. THE Provenance_Footer SHALL display a link to the Methodology_Page.
8. THE Methodology_Page SHALL state that f-Socials describes framing and evidence and SHALL NOT present verdicts about content or labels about creators.
9. THE Methodology_Page SHALL meet WCAG_2.2_AA contrast in both light mode and dark mode, with text contrast of at least 4.5:1 (at least 3:1 for large text) and non-text user-interface and graphical elements of at least 3:1.
10. THE Methodology_Page SHALL define each Glossary term on its first use.
11. WHEN a reader activates the Methodology_Page link in the Provenance_Footer, THE Web_App SHALL navigate to the Methodology_Page.
12. IF the Methodology_Page route cannot be served, THEN THE Web_App SHALL display an unavailable indication and SHALL retain the reader's report context.

### Requirement 2: Source-Tier Credibility Policy

**User Story:** As a reader inspecting citations, I want sources rated by a transparent and defensible reliability policy, so that established institutions are not mis-rated and I can judge each source.

#### Acceptance Criteria

1. THE Source_Tier_Policy SHALL assign each Citation exactly one Source_Tier from the ordered set `tier1_primary` > `tier2_institutional` > `tier3_viewpoint` > `excluded`.
2. THE Source_Tier_Policy SHALL derive Source_Tier assignments only from Open_Signals (IFCN signatory lists, domain registries, and press-council membership) and SHALL NOT depend on Ad Fontes, AllSides, MBFC, or any other reliability dataset whose commercial-use license is unresolved.
3. WHEN a source's host is operated by a fact-checking organization on the current IFCN signatory list, THE Source_Tier_Policy SHALL classify that Citation as at least `tier2_institutional`.
4. WHEN a source's host belongs to an Open_Signal domain registry for academic, governmental, or institutional publishers, THE Source_Tier_Policy SHALL classify that Citation as `tier2_institutional`, including when no other Open_Signal matches that host.
5. THE Source_Tier_Policy SHALL expose a version identifier that matches the version displayed on the Methodology_Page and in the Provenance_Footer.
6. THE API_Server SHALL attach a Source_Tier to every Citation it returns.
7. THE Source_Tier_Policy SHALL apply only to sources and citations and SHALL NOT produce any reliability rating attached to a content creator.
8. IF a source's host matches no Open_Signal, THEN THE Source_Tier_Policy SHALL classify that Citation as `tier3_viewpoint`.
9. WHEN a Citation is displayed in a report, THE Web_App SHALL render a Source_Chip whose label maps to the Citation's assigned Source_Tier and never to a content creator.
10. WHEN a source's host matches more than one Open_Signal, THE Source_Tier_Policy SHALL assign the Source_Tier corresponding to the highest-ranked matching signal.
11. IF a source's host cannot be resolved to a valid publishing domain, THEN THE Source_Tier_Policy SHALL classify that Citation as `excluded`.

### Requirement 3: Dispute and Flag Intake

**User Story:** As a reader who disagrees with an analysis, I want to submit a dispute or flag a framing technique, so that my objection is recorded for later review.

#### Acceptance Criteria

1. WHEN a client sends `POST /analyses/:id/disputes` with a reason between 1 and 2000 characters for an existing Analysis_Report, THE API_Server SHALL persist a Dispute associated with that report and SHALL respond with a success status.
2. THE API_Server SHALL accept and persist a Dispute submission without requiring authentication and without associating the Dispute with a user identity.
3. WHEN a client sends `POST /analyses/:id/flags` for an existing Analysis_Report, THE API_Server SHALL require authentication via requireAuth before persisting a Flag.
4. IF a client sends `POST /analyses/:id/flags` without valid authentication, THEN THE API_Server SHALL reject the request with an authentication-required status and SHALL NOT persist a Flag.
5. WHEN an authenticated client sends `POST /analyses/:id/flags` with a technique that matches one of the framing techniques present in the referenced Analysis_Report, THE API_Server SHALL persist a Flag associated with that report and the authenticated user.
6. IF a Dispute or Flag request targets a report identifier that does not exist, THEN THE API_Server SHALL respond with a not-found status and SHALL NOT persist any Dispute or Flag.
7. IF a Dispute or Flag request body fails validation (missing reason, reason exceeding 2000 characters, or a technique that does not match a framing technique in the referenced Analysis_Report), THEN THE API_Server SHALL reject the request with a validation-error status indicating the invalid fields and SHALL NOT persist any Dispute or Flag.
8. WHEN a user submits the Dispute_Modal pre-filled with a claim identifier, THE Web_App SHALL send the claim identifier and the user-entered reason to the dispute endpoint.
9. WHEN the dispute endpoint returns a success status, THE Web_App SHALL display a confirmation that the Dispute was received.
10. THE Provenance_Footer SHALL display a control that opens the Dispute_Modal.
11. WHERE a Flag or save action requires authentication and the current user is unauthenticated, THE Web_App SHALL prompt the user to authenticate before submitting.

### Requirement 4: UI Polish and Accessibility Pass

**User Story:** As a reader using any device or assistive technology, I want the report to be legible, navigable, and free of verdict-coded color, so that I can use f-Socials regardless of ability or device.

#### Acceptance Criteria

1. WHEN an Analysis_Report contains no items for a given section, THE Web_App SHALL display an empty-state message within that section while continuing to render all other sections.
2. IF a report request fails or returns an error status, THEN THE Web_App SHALL display an error state that indicates the failure to the reader, SHALL present a control to retry the request or return to the previous view, and SHALL NOT render a partial Analysis_Report.
3. WHERE the viewport width is 768 pixels or less, THE Web_App SHALL render the Analysis_Report in a single-column layout with no horizontal scrolling required to read any content.
4. THE Web_App SHALL render the Analysis_Report at WCAG_2.2_AA contrast in both light mode and dark mode, with text contrast of at least 4.5:1 for body text, at least 3:1 for large text, and at least 3:1 for interactive-control and graphical boundaries.
5. THE Web_App SHALL replace the `#00ffe5` brand-accent color with the muted teal `#0d9488` defined as the evidence-backed (success) token in `tokens.json` for evidence-backed and accent signals.
6. WHERE the Web_App conveys meaning through color, THE Web_App SHALL display a text label adjacent to that color signal that conveys the equivalent meaning, such that no status or verdict is communicated by color alone.
7. THE Web_App SHALL support keyboard-only operation of claim drawers, framing tabs, and the Dispute_Modal; WHEN one of these controls is opened, THE Web_App SHALL move keyboard focus into it; WHILE the Dispute_Modal is open, THE Web_App SHALL confine keyboard focus to the Dispute_Modal; and WHEN the reader presses Escape or activates the dismiss control, THE Web_App SHALL close the control and return focus to the element that opened it.
8. WHEN a framing-technique tooltip is rendered, THE Web_App SHALL provide a programmatically associated ARIA description that is exposed to screen readers.
9. THE Web_App SHALL provide a screen-reader-accessible textual representation of every issue-frame chart position.
10. WHEN the Analysis_Report is first rendered, THE Web_App SHALL display the TLDR summary and the single most important framing signal without requiring the reader to expand any drawer or other collapsed content.

### Requirement 5: Production Build and Safe Deployment

**User Story:** As an operator deploying f-Socials publicly, I want a real build step and enforced access controls in the deployed configuration, so that the public lens runs safely.

#### Acceptance Criteria

1. WHEN the API_Server build step runs and compilation completes without error, THE API_Server SHALL produce a distributable output runnable without `tsx`.
2. IF the API_Server build step encounters a compilation error, THEN THE API_Server build step SHALL terminate with a non-zero exit status and SHALL report the compilation error that caused the failure.
3. WHEN the Web_App build step runs and compilation completes without error, THE Web_App SHALL produce a deployable static bundle.
4. IF the Web_App build step encounters a compilation error, THEN THE Web_App build step SHALL terminate with a non-zero exit status and SHALL report the compilation error that caused the failure.
5. WHERE the API_Server runs in the deployed configuration, THE API_Server SHALL enforce requireAuth on every route that requires authentication.
6. WHERE the API_Server runs in the deployed configuration, THE Rate_Limiter SHALL enforce the per-key daily limit on new analyses.
7. WHEN the API_Server receives a cross-origin request whose origin matches the value configured by the `CORS_ORIGIN` setting, THE API_Server SHALL apply that origin as the allowed origin for the response.
8. IF the API_Server receives a cross-origin request whose origin does not match the value configured by the `CORS_ORIGIN` setting, THEN THE API_Server SHALL reject the request and SHALL NOT return the requested resource to that origin.
9. THE Web_App SHALL direct API requests to the base URL configured by the `VITE_API_BASE` setting.
10. THE Worker SHALL run as a long-running process separate from the API_Server in the deployed configuration.
11. IF a required deployment configuration value is missing at startup, THEN THE API_Server SHALL exit without binding its listening port and SHALL report the name of the missing configuration value.
12. IF requireAuth or the Rate_Limiter fails to activate in the deployed configuration, THEN THE API_Server SHALL proceed to start and SHALL log a warning that names the access control that did not activate.

### Requirement 6: Preserve the Invariant Gate and Neutrality

**User Story:** As the steward of f-Socials' credibility, I want the invariant gate and neutrality principle preserved across this bundle, so that the system never asserts evidence it cannot cite and never becomes a judge.

#### Acceptance Criteria

1. IF an Analysis_Report contains a claim whose evidence strength is `weak`, `moderate`, or `strong` and that claim has zero Citations, THEN THE Invariant_Gate SHALL hold the Analysis_Report at `needs_review` and SHALL record a needs_review reason identifying the uncited claim.
2. WHEN an Analysis_Report contains a claim whose evidence strength is `none` and that claim has zero Citations, THE Invariant_Gate SHALL treat that claim as satisfying the citation invariant, SHALL NOT record a needs_review reason for that claim, and SHALL permit the Analysis_Report to reach `ready`.
3. IF any framing signal in an Analysis_Report has zero examples, or has an example whose quote is empty or whose explanation is empty, THEN THE Invariant_Gate SHALL hold the Analysis_Report at `needs_review` and SHALL record a needs_review reason identifying the deficient framing signal.
4. THE Invariant_Gate SHALL set an Analysis_Report to `ready` if and only if the Analysis_Report has zero needs_review reasons, and SHALL otherwise set the Analysis_Report to `needs_review`.
5. THE f-Socials system SHALL NOT display, on any surface introduced by this bundle, any verdict about content, any assessment of content factual truthfulness, or any reliability rating attached to a content creator.
