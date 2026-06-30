# Implementation Plan: EN/NL Localization

## Overview

This plan internationalizes the React web client (`app/apps/web`) for English (`en`) and Dutch (`nl`). It is a presentation-layer-only change: the server, the analysis pipeline, and the invariant gate (`core/assemble.ts`) are never touched.

The build order is bottom-up and incremental: the catalog types and the two catalogs first, then the four pure modules (resolver, detector, persistence, formatter), then the React context provider and hook, then the `Language_Selector`, then the root wiring, then the per-surface consumer refactors. Property tests sit next to the pure module they validate so errors surface early. Each step builds on the previous one and ends with the i18n layer fully wired into every view.

Conventions followed: TypeScript ESM with extensionless relative imports, React 19 context (no i18n dependency), native `Intl`, `lucide-react` icons, hash routing, color-never-alone, and `fast-check` property tests (≥100 runs) under Vitest with the `// Feature: en-nl-localization, Property <n>` tag and a `Validates: Requirements …` reference.

## Tasks

- [x] 1. Establish the i18n module foundation
  - [x] 1.1 Create the catalog types module
    - Create `app/apps/web/src/i18n/catalog.ts`
    - Define `Language = 'en' | 'nl'`, `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE = 'en'`, and the `MessageCatalog` type
    - Implement the `isSupportedLanguage(v: unknown): v is Language` type guard (the single source of truth for "is this a supported language")
    - _Requirements: 1.1, 4.2_

- [x] 2. Author the Message_Catalogs
  - [x] 2.1 Create the canonical English catalog
    - Create `app/apps/web/src/i18n/en.ts` exporting `const en = { … } as const` and `export type EnCatalog = typeof en`
    - Enumerate every UI_Chrome String_Key with dotted, surface-grouped identifiers covering: home (heading, description, placeholder, analyze control, neutrality hint, example titles/blurbs), loading (analyzing label + analysis step names), report (section titles, save/share/flag/dispute controls, status banners, empty states, provenance labels), the display-label maps (`report.strength.*`, `report.verifiability.*`, `report.tier.*`, `report.divergence`, issue-frame axis poles, readiness display labels), methodology, error view (Retry/Back), dispute/flag, sign-in, history, workspaces, and the `lang.*` selector strings
    - Express runtime values as named `{placeholder}` tokens (e.g. `loading.analyzing`, `report.counts.claims`, `report.divergence`)
    - Keep every value descriptive — no truthfulness verdict, no creator/channel reliability rating; source-tier values describe a source/citation only
    - _Requirements: 4.1, 4.2, 4.4, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 9.4, 9.6_

  - [x] 2.2 Create the Dutch catalog typed against English
    - Create `app/apps/web/src/i18n/nl.ts` exporting `const nl: typeof en = { … }` so a missing or extra String_Key is a `tsc -b` error (compile-time parity)
    - Translate every value, keeping the Dutch evidence-strength, verifiability, issue-frame, and source-tier labels describing the same attribute as their English counterparts with no verdict or creator rating introduced
    - _Requirements: 4.2, 4.3, 4.7, 7.4, 9.6_

  - [x] 2.3 Write property test for catalog parity and completeness
    - **Property 5: Catalog parity and completeness**
    - **Validates: Requirements 4.3, 9.1, 9.2, 9.3, 9.4, 9.6**
    - `i18n/catalog.parity.test.ts`: for any String_Key in either catalog the same key exists in the other, and every value in every Supported_Language is a non-empty, non-whitespace string

  - [x] 2.4 Write the neutrality denylist scan
    - `i18n/neutrality.scan.test.ts`: iterate every value of both catalogs against a curated denylist of truthfulness-verdict and creator-rating phrasings; fail the suite and name the offending String_Key when a value matches
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

- [x] 3. Implement the resolver and placeholder substitution
  - [x] 3.1 Create `app/apps/web/src/i18n/resolve.ts`
    - Implement `resolve(key, language, catalogs)` with the fallback chain: active catalog → default (`en`) catalog → non-empty visible placeholder derived from the key's last dotted segment; whitespace-only values count as absent
    - Implement `fill(template, values?)`: substitute named `{placeholder}` tokens, leaving any token with no supplied value visible (never blanked)
    - Implement `translate(key, language, catalogs, values?)` = resolve then fill; guarantee a non-empty string on every path (never throws)
    - _Requirements: 1.7, 2.6, 2.7, 2.8, 4.4, 4.6, 4.8, 5.6, 9.5, 11.6_

  - [x] 3.2 Write property test for resolution totality with fallback
    - **Property 1: Resolution totality with fallback**
    - **Validates: Requirements 1.7, 2.6, 2.7, 2.8, 4.6, 5.6, 8.9, 9.5, 11.6**
    - `i18n/resolve.totality.test.ts`: arbitrary keys (known + unknown) × Supported_Languages, plus whitespace-only catalog values, always resolve to a non-empty string via the fallback chain

  - [x] 3.3 Write property test for placeholder substitution round-trip
    - **Property 6: Placeholder substitution round-trip**
    - **Validates: Requirements 4.4, 4.8**
    - `i18n/fill.placeholder.test.ts`: substitution contains each supplied value with no remaining resolved token; tokens with no supplied value stay visible and the message stays non-empty

- [x] 4. Implement the Locale_Detector
  - [x] 4.1 Create `app/apps/web/src/i18n/detect.ts`
    - Implement `detectLanguage(preferences)`: walk preferences highest→lowest priority, return the first whose primary subtag matches `en`/`nl` case-insensitively (any region tag), else `DEFAULT_LANGUAGE`
    - Implement `detectFromNavigator()` reading `navigator.languages` (falling back to `[navigator.language]`)
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 4.2 Write property test for detection totality and priority
    - **Property 2: Detection totality and priority**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - `i18n/detect.test.ts`: arbitrary preference lists (random region suffixes, random casing, empty lists) return the highest-priority supported match, else the Default_Language

- [x] 5. Implement the Persistence_Store adapter
  - [x] 5.1 Create `app/apps/web/src/i18n/persist.ts`
    - `STORAGE_KEY = 'fsocials-language'`
    - `readStoredLanguage()`: read + validate against `isSupportedLanguage`; missing/invalid/unreadable → `null`
    - `writeStoredLanguage(language)`: wrap in `try/catch`, swallow storage rejection (private mode/quota), never throw
    - `resolveInitialLanguage()`: stored-if-valid → `detectFromNavigator()` → `DEFAULT_LANGUAGE`
    - Browser-local storage only; introduce no routing dependency
    - _Requirements: 2.1, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 10.2, 10.3, 10.4_

  - [x] 5.2 Write property test for persistence round-trip and totality
    - **Property 3: Persistence round-trip and totality**
    - **Validates: Requirements 2.1, 2.5, 3.1, 3.2, 3.3, 10.2, 10.3, 10.4**
    - `i18n/persist.roundtrip.test.ts`: writing any Supported_Language then `resolveInitialLanguage()` restores it; absent/invalid stored values fall through to detection and still return a Supported_Language without throwing

  - [x] 5.3 Write unit edge-case test for storage rejection
    - `i18n/persist.edgecases.test.ts`: with a stubbed `localStorage` that rejects writes, `writeStoredLanguage` does not throw and the caller keeps the selected language in session
    - _Requirements: 3.4_

- [x] 6. Implement the Locale_Formatter
  - [x] 6.1 Create `app/apps/web/src/i18n/format.ts`
    - `LOCALE: Record<Language, string> = { en: 'en-US', nl: 'nl-NL' }`
    - `formatDate(value, language, opts?)` and `formatNumber(value, language, opts?)` via `Intl`, guarded so an invalid value returns its original unformatted string and a missing `Intl` returns the unformatted value
    - Use the browser's built-in internationalization facilities only — no external service
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

  - [x] 6.2 Write property test for format presentation-only (metamorphic)
    - **Property 8: Format presentation-only (metamorphic) with invalid-input fallback**
    - **Validates: Requirements 6.4, 6.6**
    - `i18n/format.metamorphic.test.ts`: for valid dates/numbers the `en` and `nl` outputs represent the same underlying value and differ only in presentation; invalid inputs (`NaN`, non-date strings) pass through unchanged

  - [x] 6.3 Write unit edge-case test for Intl unavailability
    - `i18n/format.intlUnavailable.test.ts`: with `Intl` stubbed unavailable, the formatter returns the unformatted representation without throwing
    - _Requirements: 6.7_

- [x] 7. Checkpoint - pure i18n layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the LanguageProvider context and hooks
  - [x] 8.1 Create `app/apps/web/src/i18n/context.tsx`
    - `LanguageProvider` holds `language` in `useState(resolveInitialLanguage())` and exposes `language`, `setLanguage`, `t`, `formatDate`, `formatNumber` via `useT`/`useLocale`/`useFmt` hooks
    - `setLanguage(next)`: no-op when `next === language` (idempotent, DOM unchanged); otherwise set state (synchronous re-render, no reload), write to the Persistence_Store, and set `document.documentElement.lang` to the primary subtag — leave the previous `lang` untouched when no subtag resolves
    - `t` closes over `language` + the bundled catalogs and delegates to `translate`; `formatDate`/`formatNumber` close over `language`
    - _Requirements: 1.2, 1.3, 1.5, 3.1, 6.3, 8.4, 8.5, 9.7_

  - [x] 8.2 Write property test for switch idempotence
    - **Property 4: Switch idempotence**
    - **Validates: Requirements 1.5**
    - `i18n/switch.idempotence.test.tsx`: setting the Active_Language to the value it already holds leaves the rendered UI_Chrome unchanged

  - [x] 8.3 Write property test for document language reflecting Active_Language
    - **Property 9: Document language reflects Active_Language**
    - **Validates: Requirements 8.4**
    - `i18n/htmlLang.test.tsx`: setting the Active_Language sets `<html lang>` to the primary subtag of that language

  - [x] 8.4 Write unit edge-case test for unresolvable primary subtag
    - `i18n/htmlLang.edgecases.test.tsx`: when no primary subtag resolves, the previous `<html lang>` is left unchanged and no Reader-visible error is raised
    - _Requirements: 8.5_

- [x] 9. Implement the Language_Selector
  - [x] 9.1 Create `app/apps/web/src/components/LanguageSelector.tsx`
    - Two native `<button>`s in a `role="group"` with an `aria-label` from `t('lang.label')`, each showing the language's visible text name with `aria-pressed` reflecting the Active_Language
    - Keyboard reachable (Tab) and activatable (Enter/Space, native buttons) with the standard focus indicator; any icon sourced from `lucide-react` (`Languages`) sitting beside a visible text label
    - Inherits the existing ≤768px single-column layout
    - _Requirements: 1.1, 1.4, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 8.9_

  - [x] 9.2 Write unit + accessibility tests for the Language_Selector
    - `components/LanguageSelector.test.tsx`: exactly two options, active text label + `aria-pressed`, keyboard reachability/activation, `role="group"` + non-empty `aria-label`, `lucide-react` icon present, color-never-alone, `vitest-axe` no violations
    - _Requirements: 1.1, 1.3, 1.4, 8.1, 8.2, 8.6, 8.8, 8.9_

- [x] 10. Wire the provider and selector into the app root
  - [x] 10.1 Mount the LanguageProvider and place the selector
    - Wrap the app in `LanguageProvider` in `app/apps/web/src/main.tsx` (or the root of `App.tsx`)
    - Place `LanguageSelector` in the existing header `topbar-actions` beside the theme toggle
    - On first load with no stored choice, the default Active_Language is English via `resolveInitialLanguage`
    - _Requirements: 1.1, 1.6, 2.1_

- [x] 11. Refactor consumer surfaces to resolve text through `t(...)`
  - [x] 11.1 Localize the home and loading views
    - In `App.tsx`, replace hardcoded literals with `t(...)`: home heading, description, input placeholder, analyze control, neutrality hint, example titles/blurbs; loading analyzing label and the analysis `STEPS` names
    - _Requirements: 9.1, 9.2, 5.1, 7.5_

  - [x] 11.2 Localize the report view and the display-label maps
    - In `Report.tsx`, `reportView.ts`, and `SummaryLead.tsx`, replace section titles, save/share/flag/dispute controls, status banners, empty-state messages, and provenance labels with `t(...)`
    - Convert the display-label maps to catalog lookups: `STRENGTH[s].label → t('report.strength.' + s)`, `VERIFIABILITY[v] → t('report.verifiability.' + v)`, `TIER[tier] → t('report.tier.' + tier)`, `divergenceLabel(d) → t('report.divergence', { word, pct })`, issue-frame axis poles, and the readiness display label — keep icon/class parts in the component
    - Read only enumeration discriminants to pick a String_Key; never read, map, or transform Report_Content free-text fields
    - _Requirements: 9.3, 5.3, 11.2, 11.6_

  - [x] 11.3 Localize the remaining views
    - Replace literals with `t(...)` in `Methodology.tsx`, the error view (Retry/Back), `DisputeModal.tsx` and the flag control, `AuthPanel.tsx` (sign-in), `HistoryView.tsx`, and the workspace views (`WorkspaceListView.tsx`, `WorkspaceDetailView.tsx`)
    - _Requirements: 9.4_

  - [x] 11.4 Route dates and numbers through the Locale_Formatter
    - Replace bare `new Date(iso).toLocaleString()` and numeric formatting in `WorkspaceDetailView.tsx`, `HistoryView.tsx`, and any visible counts with `useFmt` `formatDate`/`formatNumber`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 11.5 Write property test for content invariance under language switch
    - **Property 7: Content invariance under language switch**
    - **Validates: Requirements 5.2, 5.5, 5.7, 11.2, 11.3, 11.5**
    - `i18n/report.contentInvariance.test.tsx`: for any generated report, rendering under `en` and `nl` produces identical Report_Content text and identical section counts (claims, framing signals, context cards, citations, perspectives); reuse the existing report arbitraries

- [x] 12. Checkpoint - full surface coverage
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Add the constraint and gate guard tests
  - [x] 13.1 Write static guard tests for offline-first and no-dependency constraints
    - `i18n/staticGuards.i18n.test.ts`: assert catalogs are static imports (no runtime fetch), no router/network/external-service dependency is introduced, the selector icon comes from `lucide-react`, and no server file under `app/apps/server` was changed for localization
    - _Requirements: 3.5, 4.1, 4.5, 5.4, 10.1, 10.5, 10.7, 11.4_

  - [x] 13.2 Write the byte-identical gate guard test
    - Assert (or reuse the existing invariant guard) a byte-level comparison confirming `core/assemble.ts` is identical to its committed state, and that no localization import reaches into the gate
    - _Requirements: 11.1_

- [x] 14. Final checkpoint - run the web suite
  - Ensure all tests pass (`npx vitest run` and `tsc -b` in `app/apps/web`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (granular clauses) for traceability.
- Property tests (Properties 1–9 from the design) sit next to the module they validate so failures surface early; each carries the `// Feature: en-nl-localization, Property <n>: <description>` comment and a `Validates: Requirements …` reference.
- Compile-time parity (`nl: typeof en`) plus the parity property test (2.3) together satisfy Req 4.3/4.7; the build fails on divergent keys via `tsc -b`.
- The neutrality scan (2.4) and the byte-identical gate guard (13.2) are the build-gate checks that keep the Compass and the invariant gate intact.
- Run before claiming done, per project steering: `npx vitest run` and `tsc -b` in `app/apps/web`. No server suite change is expected.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "5.1", "3.2", "3.3", "4.2", "6.2", "6.3"] },
    { "id": 3, "tasks": ["2.3", "2.4", "5.2", "5.3", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1"] },
    { "id": 6, "tasks": ["11.1", "11.2"] },
    { "id": 7, "tasks": ["11.3"] },
    { "id": 8, "tasks": ["11.4", "11.5", "13.1", "13.2"] }
  ]
}
```
