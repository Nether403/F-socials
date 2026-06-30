# Requirements Document

## Introduction

This feature is the "EN/NL localization" item in the f-Socials roadmap "Pilots" phase (§5). It internationalizes the React web client (`app/apps/web`) so its user-facing interface can be presented in English or Dutch, as groundwork for EDMO/BENEDMO (Dutch / European) educator and library outreach.

The work is presentation-layer only. Today the Web_App carries its interface copy as hardcoded English literals scattered across `App.tsx`, `Report.tsx`, the static `Methodology` page, the auth/history/workspace views, error and empty states, and the dispute/flag controls — plus display-label maps that translate engine enumerations into human-readable text (for example the evidence-strength map `{strong: "Well-sourced", …}`, the verifiability map, and the source-tier map). This feature moves that interface copy behind a single in-app source of truth with an English catalog and a Dutch catalog, adds a Language_Selector to switch between them, persists the choice, and formats dates and numbers for the Active_Language.

The feature draws a hard line between two kinds of text:

- **UI_Chrome** — the fixed interface copy authored as part of the product (labels, headings, buttons, status and error messages, empty states, example titles/blurbs, and the display-label maps for engine enumerations). This is what gets localized.
- **Report_Content** — the per-report text produced by the analysis providers at runtime (claim text, framing technique names and descriptions, transcript spans, AI-written titles, citation excerpts, context-card text, `needs_review` reasons). This is generated content, not interface copy. It is **not** translated at runtime, because the offline-first path forbids depending on an external translation service, and because translating engine output would risk altering report semantics that the invariant gate protects.

The feature honors the Compass — f-Socials is a lens, not a judge. No translated string in any language may become a verdict on truthfulness or a rating tied to a content creator, author, person, or channel. The existing descriptive evidence-strength, verifiability, issue-frame, and source-tier labels stay descriptive in both languages, and source-reliability tiers stay attached to sources and citations only. The feature leaves the invariant gate in `core/assemble.ts` byte-for-byte unchanged (read-only), preserves the offline-first path (no API keys, mock providers, in-memory infra), and preserves the web accessibility conventions (color/icon-never-alone, ARIA wiring, keyboard operability, ≤768px single column).

## Glossary

- **Web_App**: The React 19 + Vite web client in `app/apps/web`, using hash routing (`#/...`) with no router dependency and icons from `lucide-react`.
- **Language**: A human language the Web_App interface can be presented in.
- **Supported_Languages**: The set of Languages this feature supports, exactly English (`en`) and Dutch (`nl`).
- **Default_Language**: English (`en`), the Language used when no valid choice is stored and locale detection yields no Supported_Language.
- **Active_Language**: The Supported_Language currently in effect for the Web_App interface.
- **Language_Selector**: The Web_App control through which a Reader sets the Active_Language.
- **Reader**: A person using the Web_App.
- **String_Key**: A stable identifier naming one piece of UI_Chrome text (for example `home.analyzeButton`).
- **Message_Catalog**: A per-Language mapping from String_Key to the displayed text for that Language. There is one Message_Catalog per Supported_Language.
- **UI_Chrome**: The fixed product-authored interface text rendered by the Web_App — labels, headings, buttons, status/error/empty-state messages, example titles and blurbs, and the display-label maps that render engine enumerations (evidence strength, verifiability, source tier, issue-frame axis poles, divergence words, analysis step names).
- **Report_Content**: The per-report text produced by the analysis providers at runtime (claim text, framing technique names and descriptions, transcript text, AI-written report titles, citation excerpts and source names, context-card titles and descriptions, `needs_review` reasons).
- **Locale_Detector**: The Web_App logic that maps the Reader's browser-reported language preferences to a Supported_Language or to the Default_Language.
- **Locale_Formatter**: The Web_App logic that formats dates, times, and numbers for the Active_Language.
- **Persistence_Store**: The browser-local storage the Web_App uses to retain the Reader's Active_Language choice across reloads, in the same manner the existing theme choice is retained.
- **Invariant_Gate**: The report-readiness gate in `app/apps/server/src/core/assemble.ts`; read-only for this feature and never weakened.

## Requirements

### Requirement 1: Select and switch the interface language

**User Story:** As a Reader, I want to choose between English and Dutch for the interface, so that I can use f-Socials in the language I read most comfortably.

#### Acceptance Criteria

1. THE Web_App SHALL present a Language_Selector offering exactly the Supported_Languages English and Dutch.
2. WHEN a Reader selects a Supported_Language in the Language_Selector, THE Web_App SHALL set the Active_Language to the selected Language.
3. WHEN the Active_Language changes, THE Web_App SHALL re-render all visible UI_Chrome in the Active_Language within 1 second and without requiring a page reload.
4. THE Language_Selector SHALL indicate which Supported_Language is the current Active_Language with a visible text label that does not rely on color or icon alone.
5. WHEN a Reader selects the Supported_Language that is already the Active_Language, THE Web_App SHALL keep that Language as the Active_Language and SHALL leave the displayed UI_Chrome unchanged.
6. WHEN the Web_App loads and no Supported_Language has been selected by the Reader, THE Web_App SHALL set the Active_Language to English as the default Active_Language.
7. IF a UI_Chrome element has no available translation in the Active_Language, THEN THE Web_App SHALL display that element in English and SHALL render the remaining translated UI_Chrome in the Active_Language unchanged.

### Requirement 2: Default language, locale detection, and fallback

**User Story:** As a first-time Reader, I want the interface to open in a sensible language without configuration, so that I am not forced to choose before I can use the tool.

#### Acceptance Criteria

1. WHEN the Web_App loads AND the Persistence_Store holds a stored Active_Language that is a Supported_Language, THE Web_App SHALL set the Active_Language to that stored Language and render UI_Chrome in that Language.
2. WHEN the Web_App loads AND the Persistence_Store holds no stored Active_Language, THE Locale_Detector SHALL resolve the Active_Language from the Reader's browser-reported language preferences, evaluated in the order the browser reports them from highest to lowest priority.
3. WHEN the Locale_Detector evaluates the browser-reported language preferences AND at least one preference resolves to a Supported_Language, THE Locale_Detector SHALL select the highest-priority preference that resolves to a Supported_Language and set the Active_Language to it, matching case-insensitively on the primary language subtag so that any `en` region tag resolves to English and any `nl` region tag resolves to Dutch.
4. IF the Locale_Detector finds no browser-reported preference that resolves to a Supported_Language, THEN THE Web_App SHALL set the Active_Language to the Default_Language.
5. IF the Persistence_Store holds a stored Active_Language value that is not a Supported_Language, THEN THE Web_App SHALL ignore the stored value and resolve the Active_Language through the Locale_Detector following criteria 2 through 4.
6. WHEN the Web_App renders UI_Chrome for a String_Key that is absent from the Active_Language Message_Catalog AND present in the Default_Language Message_Catalog, THE Web_App SHALL render the text for that String_Key from the Default_Language Message_Catalog.
7. IF the Web_App resolves UI_Chrome for a String_Key that is absent from both the Active_Language Message_Catalog and the Default_Language Message_Catalog, THEN THE Web_App SHALL render a non-empty visible placeholder derived from that String_Key rather than rendering an empty string or failing to render.
8. WHEN the Web_App resolves UI_Chrome for any String_Key in any Supported_Language, THE Web_App SHALL return a non-empty string.

### Requirement 3: Persist the language choice

**User Story:** As a returning Reader, I want my language choice remembered, so that I do not have to reselect it on every visit.

#### Acceptance Criteria

1. WHEN a Reader sets the Active_Language through the Language_Selector, THE Web_App SHALL write the selected Language to the Persistence_Store before the next page reload.
2. WHEN the Web_App reloads and the Persistence_Store holds a previously stored Language that is one of the supported Languages, THE Web_App SHALL set the Active_Language to that stored Language.
3. IF the Web_App reloads and the Persistence_Store holds no stored Language or holds a value that is not one of the supported Languages, THEN THE Web_App SHALL fall back to the default Active_Language and SHALL continue rendering without raising an unhandled error.
4. IF the Persistence_Store is unavailable or rejects a write when the Reader sets the Active_Language, THEN THE Web_App SHALL keep the selected Active_Language in effect for the remainder of the current session and SHALL continue rendering without raising an unhandled error.
5. THE Web_App SHALL retain the Active_Language choice using browser-local storage only and SHALL NOT introduce any third-party routing dependency to do so.

### Requirement 4: Single in-app source of truth for translatable strings

**User Story:** As a maintainer, I want all translatable interface text to live in one structured place, so that adding or correcting a translation is a single, reviewable change.

#### Acceptance Criteria

1. THE Web_App SHALL resolve every piece of UI_Chrome text through a String_Key looked up in the active Message_Catalog rather than from a hardcoded display literal at the point of rendering.
2. THE Web_App SHALL provide exactly one Message_Catalog for English and exactly one Message_Catalog for Dutch.
3. THE English Message_Catalog and the Dutch Message_Catalog SHALL define an identical set of String_Keys, with neither catalog containing a String_Key absent from the other.
4. WHERE a UI_Chrome message includes a runtime value (for example an item count or a status detail), THE Message_Catalog entry SHALL express that value as a named placeholder, and WHEN the Web_App renders that message, THE Web_App SHALL substitute the supplied runtime value into the matching named placeholder.
5. THE Web_App SHALL source all Message_Catalog text from assets bundled with the Web_App build and SHALL NOT fetch interface translations from an external service at runtime.
6. IF a String_Key required to render a piece of UI_Chrome has no entry in the active Message_Catalog, THEN THE Web_App SHALL render the String_Key identifier as a visible fallback in place of the missing text and SHALL continue rendering the remaining UI_Chrome.
7. WHEN the Web_App build is produced, IF the English Message_Catalog and the Dutch Message_Catalog do not define identical sets of String_Keys, THEN THE Web_App build SHALL fail and report an error identifying the divergent String_Keys.
8. IF a named placeholder in a Message_Catalog entry has no corresponding runtime value supplied at render time, THEN THE Web_App SHALL render the remaining message text and leave the unmatched placeholder visible rather than rendering empty text.

### Requirement 5: Localize the interface, not the generated report content

**User Story:** As a Reader, I want the interface chrome translated while the analyzed content stays exactly as the engine produced it, so that switching language never alters what a report says.

#### Acceptance Criteria

1. WHEN the Active_Language changes, THE Web_App SHALL render UI_Chrome in the Active_Language without requiring a page reload.
2. WHEN the Active_Language changes, THE Web_App SHALL render Report_Content in the source text exactly as produced by the analysis providers, with no characters added, removed, reordered, or substituted, regardless of the Active_Language.
3. THE Web_App SHALL render the display-label maps for evidence strength, verifiability, source tier, issue-frame axis poles, divergence magnitude, and analysis-step names as UI_Chrome resolved through the Active_Language Message_Catalog.
4. THE feature SHALL NOT send Report_Content to any translation service.
5. THE feature SHALL preserve every field of a report unaltered, un-reordered, and not re-authored when rendering it in any Active_Language.
6. IF a UI_Chrome String_Key is absent from the Active_Language Message_Catalog, THEN THE Web_App SHALL render the Default_Language (English) text for that String_Key rather than empty text or a raw String_Key.
7. WHEN the Web_App renders a report whose Report_Content is in a different language from the Active_Language, THE Web_App SHALL render that Report_Content in its original language without translating it and without raising an error.

### Requirement 6: Locale-aware date and number formatting

**User Story:** As a Reader, I want dates and numbers shown in my language's conventions, so that the interface reads naturally.

#### Acceptance Criteria

1. WHEN the Web_App displays a date or time value in UI_Chrome, THE Locale_Formatter SHALL render that value using the Active_Language's date and time conventions, covering date-component order, component separators, month and weekday names, and clock style (12-hour or 24-hour).
2. WHEN the Web_App displays a numeric value in UI_Chrome, THE Locale_Formatter SHALL render that value using the Active_Language's number conventions, covering decimal separator, grouping separator, and grouping placement.
3. WHEN the Active_Language changes, THE Web_App SHALL reformat every visible locale-formatted date and number to the Active_Language conventions within 1 second and without a page reload.
4. WHEN the Locale_Formatter formats a value, THE Locale_Formatter SHALL preserve the underlying value's meaning and SHALL change only its presentation.
5. THE Locale_Formatter SHALL format values using the browser's built-in internationalization facilities and SHALL NOT require an external service.
6. IF a value passed to the Locale_Formatter is not a valid date, time, or number, THEN THE Locale_Formatter SHALL display the value's original unformatted representation unchanged and SHALL emit no locale formatting for it.
7. IF the browser's built-in internationalization facilities are unavailable, THEN THE Locale_Formatter SHALL display the value's unformatted representation.

### Requirement 7: Compass neutrality across languages

**User Story:** As a Reader, I want the localized interface to remain a lens and not a judge, so that no translation turns a descriptive label into a verdict or a creator rating.

#### Acceptance Criteria

1. THE Message_Catalog for every Supported_Language SHALL exclude any String_Key value that declares analyzed content to be true, false, real, fake, accurate, or inaccurate, or otherwise states a verdict on its truthfulness.
2. THE Message_Catalog for every Supported_Language SHALL exclude any String_Key value that describes a content creator, author, person, or channel as reliable, unreliable, trustworthy, untrustworthy, credible, or not credible, or otherwise attaches a reliability rating to them.
3. WHERE a Message_Catalog entry renders a source-reliability tier, THE entry SHALL describe a source or citation and SHALL NOT describe a content creator, author, person, or channel.
4. THE Dutch evidence-strength, verifiability, issue-frame, and source-tier labels SHALL describe the same attribute their English counterparts describe — respectively the strength of supporting evidence, how checkable a claim is, the issue framing, and the source's tier — and SHALL NOT introduce a truthfulness verdict or creator rating.
5. WHEN the Web_App renders the home-page neutrality statement, THE Web_App SHALL render in the Active_Language a statement that conveys the app does not declare content true or false and issues no truthfulness verdict.
6. WHEN the Web_App build is produced, IF any Message_Catalog value in any Supported_Language matches the curated denylist of truthfulness-verdict or creator-rating phrasings, THEN THE Web_App build SHALL fail and report the offending String_Key.

### Requirement 8: Accessibility of the localized interface

**User Story:** As a Reader using assistive technology or a small screen, I want the language switcher and the translated labels to meet the app's accessibility conventions, so that localization stays inclusive.

#### Acceptance Criteria

1. WHEN a Reader operates the Language_Selector using only a keyboard, THE Web_App SHALL make the Language_Selector reachable through sequential Tab/Shift+Tab focus order and activatable via the Enter or Space key.
2. WHEN the Web_App renders the Language_Selector, THE Web_App SHALL expose on it a non-empty accessible name that identifies it as the language control and an explicit, non-generic ARIA role.
3. WHILE the Language_Selector holds keyboard focus, THE Web_App SHALL render on it a focus indicator that is visually distinct from its unfocused state.
4. WHEN the Active_Language changes, THE Web_App SHALL set the document's language attribute (`<html lang>`) to the primary subtag of the Active_Language.
5. IF the Active_Language has no resolvable primary subtag, THEN THE Web_App SHALL leave the previously set document language attribute unchanged and retain the current localized surfaces without raising a Reader-visible error.
6. WHERE a color or icon conveys state on the Language_Selector, THE Web_App SHALL display an adjacent visible text label conveying the same state.
7. WHILE the viewport width is at most 768 CSS pixels, THE Language_Selector and the localized surfaces SHALL present their content in exactly one column.
8. WHERE the Web_App adds an icon to the Language_Selector, THE Web_App SHALL source it from `lucide-react`.
9. WHEN the Web_App renders a localized control that pairs an icon or color with text, THE Web_App SHALL keep the color/icon-never-alone text label present in every Supported_Language.

### Requirement 9: Coverage of user-facing surfaces

**User Story:** As a Dutch-reading Reader, I want every interface surface translated, so that I do not hit untranslated English in the middle of a task.

#### Acceptance Criteria

1. WHILE the Active_Language is a Supported_Language, THE Web_App SHALL render the home view UI_Chrome — heading, description, input placeholder, analyze control, neutrality hint, and example titles and blurbs — in the Active_Language, with no enumerated element displaying Default_Language text while a non-Default Supported_Language is active.
2. WHILE the Active_Language is a Supported_Language, THE Web_App SHALL render the loading view UI_Chrome — the analyzing label and the analysis step names — in the Active_Language, with no enumerated element displaying Default_Language text while a non-Default Supported_Language is active.
3. WHILE the Active_Language is a Supported_Language, THE Web_App SHALL render the report view UI_Chrome — section titles, the save/share/flag/dispute controls, status banners, empty-state messages, the provenance labels, and the display-label maps — in the Active_Language, with no enumerated element displaying Default_Language text while a non-Default Supported_Language is active.
4. WHILE the Active_Language is a Supported_Language, THE Web_App SHALL render the methodology view, the error view (including Retry and Back), the dispute and flag controls, the sign-in surface, the history view, and the workspace views UI_Chrome in the Active_Language, with no enumerated element displaying Default_Language text while a non-Default Supported_Language is active.
5. IF the value resolved for an enumerated UI_Chrome String_Key is undefined, empty, or whitespace-only, THEN THE Web_App SHALL render the Default_Language text and SHALL NOT render an empty control or a raw String_Key.
6. THE Message_Catalog for every Supported_Language SHALL define a non-empty value for each enumerated UI_Chrome element in criteria 1 through 4.
7. WHEN a Reader changes the Active_Language while a view is displayed, THE Web_App SHALL re-render all visible UI_Chrome on that view in the new Active_Language within 1 second and without a page reload.

### Requirement 10: Offline-first and no runtime translation service

**User Story:** As an operator running f-Socials offline-first with zero API keys, I want localization to work without any external dependency, so that the no-keys path keeps functioning.

#### Acceptance Criteria

1. WHILE the Web_App runs with no API keys configured, THE Web_App SHALL present and switch the Active_Language using only bundled assets and browser-local facilities, with no network fetch.
2. WHEN a Reader changes the Active_Language, THE Web_App SHALL persist it so that it restores on reloads and on new browser sessions in the same browser profile.
3. WHEN the Web_App loads with no persisted Active_Language, THE Web_App SHALL set the Active_Language to the Default_Language.
4. IF the persisted Active_Language value is missing, unreadable, or not a Supported_Language, THEN THE Web_App SHALL fall back to the Default_Language and SHALL continue rendering without a Reader-visible error.
5. THE feature SHALL NOT call any external or network translation service at runtime to produce UI_Chrome.
6. WHILE the Web_App is offline, WHEN a Reader switches the Active_Language through the Language_Selector, THE Web_App SHALL re-render UI_Chrome within 1 second without raising an error.
7. THE feature SHALL leave the existing offline-first server path (mock providers, in-memory infrastructure) behaviorally unchanged and SHALL NOT add a new server configuration value or dependency for localization.

### Requirement 11: Invariant gate and report semantics untouched

**User Story:** As a maintainer, I want localization to leave the analysis pipeline and its invariant gate unchanged, so that the codified moat is preserved by construction.

#### Acceptance Criteria

1. THE feature SHALL leave `core/assemble.ts` byte-for-byte identical to its committed state at the start of this feature, verifiable by a byte-level comparison reporting no differences.
2. THE feature SHALL consume each report's readiness state, which is exactly `ready` or `needs_review`, exactly as assigned by the Invariant_Gate, and SHALL NOT recompute, override, upgrade, or downgrade the underlying value; any localized readiness wording SHALL be a display label only.
3. WHEN the Web_App renders a report in any Active_Language, THE report's claims, citations, framing signals, issue-frame coordinates, and readiness state SHALL match the count, identity, and underlying values delivered by the API.
4. THE feature SHALL NOT add, remove, reorder, or modify any stage of the analysis pipeline that produces or gates a report.
5. WHEN the Active_Language changes, THE underlying non-presentational values of a report — the number of claims, framing signals, context cards, citations, and perspectives — SHALL remain unchanged, even where their presentation labels differ across languages.
6. IF a localized readiness display label is unavailable in the Active_Language, THEN THE Web_App SHALL render the readiness label in its source-language form while preserving the underlying readiness value.

## Correctness Properties

These candidate properties inform the design phase; each maps to one or more acceptance criteria above and is amenable to `fast-check` property-based testing (≥100 runs) under Vitest.

- **Catalog parity (invariant).** For the full set of String_Keys, the English Message_Catalog and the Dutch Message_Catalog define exactly the same keys. (Req 4.3)
- **Resolution totality with fallback.** For every String_Key and every Supported_Language, resolving the key returns a non-empty string, using the Default_Language entry when the Active_Language entry is absent. (Req 2.6, 2.7, 9.5)
- **Detection totality.** For any arbitrary browser language-preference list, the Locale_Detector returns a Supported_Language — a region tag of `en`/`nl` resolves to the matching Language and anything else falls back to the Default_Language. (Req 2.3, 2.4)
- **Persistence round-trip.** For any Supported_Language, writing it to the Persistence_Store and reloading restores the same Active_Language; an invalid stored value resolves through detection instead. (Req 3.1, 3.2, 2.5)
- **Switch idempotence.** Setting the Active_Language to a value it already holds leaves the rendered UI_Chrome unchanged. (Req 1.5)
- **Content invariance under language switch.** For any report, switching the Active_Language leaves Report_Content and the rendered counts (claims, framing signals, context cards, citations, perspectives) unchanged. (Req 5.2, 11.3, 11.5)
- **Placeholder round-trip.** For any catalog message with a named placeholder and any runtime value, substituting the value yields a string that contains the value and no unresolved placeholder token. (Req 4.4)
- **Format presentation-only (metamorphic).** For any date or number, the Locale_Formatter output differs only in presentation between English and Dutch and preserves the underlying value. (Req 6.4)
- **Neutrality scan (example/edge-case).** No Message_Catalog value in any Supported_Language matches a curated denylist of truthfulness-verdict or creator-rating phrasings; verified by a static check over both catalogs rather than randomized inputs. (Req 7.1, 7.2)
