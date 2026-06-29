# Requirements Document

## Introduction

This feature is Slice 2 of the f-Socials roadmap "Pilots" phase. The analysis engine and trust surfaces are already shipped; the server already enforces Supabase JWT auth (`requireAuth`) on mutating/identity routes and applies per-key rate limiting. What is missing is the **client-side accounts experience**: the web app has no sign-in flow, so the existing Flag and Save controls always show a sign-in prompt even though the server is ready to authenticate them.

This feature delivers two coupled capabilities:

1. **Client-side authentication** — sign up, sign in, sign out, and session handling in the React web app, wired so the existing Flag/Save controls operate against a real authenticated session and attach the session token to authenticated API calls.
2. **Save and history** — a signed-in reader can save an analyzed report to their account and view a reverse-chronological list of their saved reports, so repeat use becomes possible.

The work is account/persistence plus web UI only. It introduces new `Repository` methods (in-memory and Postgres) and one additive database migration (`006`, the next after `005`). It does not touch the invariant gate in `core/assemble.ts`. It honors the Compass — f-Socials is a lens, not a judge — so no account or history surface displays any truthfulness verdict or creator-reliability rating. It preserves the offline-first path: with no auth configured, the sign-in flow degrades gracefully and the rest of the app keeps working.

## Glossary

- **Web_App**: The React 19 + Vite web client in `app/apps/web`, using hash routing (`#/...`) with no router dependency.
- **Auth_Client**: The client-side module in the Web_App that performs sign up, sign in, and sign out against Supabase Authentication and exposes the current Session.
- **Session**: The authenticated state in the Web_App after a successful sign in, holding the access token (a Supabase-issued JWT) and the identified Reader.
- **Reader**: A person using the Web_App, either Anonymous or Authenticated.
- **Access_Token**: The Supabase-issued JWT carried by a Session and sent on authenticated API requests as an `Authorization: Bearer` header.
- **API**: The Express server in `app/apps/server`, which verifies the Access_Token via `requireAuth` on identity/mutating routes.
- **Save_Control**: The existing per-report control that lets a Reader save the report to their account.
- **Flag_Control**: The existing per-report control that lets a Reader flag a framing technique (already wired to the `requireAuth`-gated flags route).
- **Saved_Report**: An association between an Authenticated Reader and an analyzed report, recording the time it was saved.
- **History_View**: The Web_App view (`#/history`) that lists an Authenticated Reader's Saved_Reports.
- **Repository**: The persistence interface in `infra/ports.ts`, implemented in-memory (`infra/memory.ts`) and over Postgres (`infra/postgres.ts`).
- **Migration_006**: The next additive database migration after `005`, adding only what save/history needs on top of the existing schema.
- **Auth_Configured**: The condition that the Web_App has the Supabase URL and anonymous key needed to reach Supabase Authentication.
- **Invariant_Gate**: The report-readiness gate in `core/assemble.ts`; read-only for this feature and never weakened.

## Requirements

### Requirement 1: Sign up

**User Story:** As an Anonymous Reader, I want to create an account, so that I can save reports and use account features.

#### Acceptance Criteria

1. WHEN an Anonymous Reader submits the sign-up form with an email and a password that pass client-side validation, THE Auth_Client SHALL request account creation from Supabase Authentication.
2. WHEN Supabase Authentication confirms account creation and returns an Access_Token within 30 seconds, THE Web_App SHALL establish a Session for the Reader and SHALL re-enable the sign-up submit control.
3. IF Supabase Authentication rejects the sign-up request, THEN THE Web_App SHALL display an error message indicating the rejection reason, SHALL leave the Reader Anonymous, and SHALL re-enable the sign-up submit control.
4. WHILE a sign-up request is in flight, THE Web_App SHALL disable the sign-up submit control.
5. IF the submitted email is empty or the submitted password is empty, THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.
6. IF the submitted email is not a syntactically valid address (local-part, "@", and a domain with a top-level domain), THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.
7. IF the submitted password is shorter than 8 characters or longer than 72 characters, THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.
8. IF Supabase Authentication does not respond within 30 seconds, THEN THE Web_App SHALL cancel the request, display an error message indicating a timeout, re-enable the sign-up submit control, and leave the Reader Anonymous.

### Requirement 2: Sign in

**User Story:** As an Anonymous Reader with an account, I want to sign in, so that my session is restored and account features become available.

#### Acceptance Criteria

1. WHEN an Anonymous Reader submits the sign-in form with an email and a password, THE Auth_Client SHALL request a session from Supabase Authentication.
2. WHEN Supabase Authentication returns an Access_Token, THE Web_App SHALL establish a Session for the Reader and SHALL make account features available.
3. IF Supabase Authentication rejects the credentials, THEN THE Web_App SHALL display an authentication-failed message, SHALL leave the Reader Anonymous, and SHALL retain the submitted email in the form.
4. WHILE a sign-in request is in flight, THE Web_App SHALL disable the sign-in submit control.
5. WHEN a sign-in request resolves with any outcome, THE Web_App SHALL re-enable the sign-in submit control.
6. IF the submitted email is empty, longer than 254 characters, or not a syntactically valid address, OR the submitted password is empty, THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.
7. IF Supabase Authentication is unreachable or does not respond within 30 seconds, THEN THE Web_App SHALL cancel the request, display an error message indicating the service is unavailable, and leave the Reader Anonymous.

### Requirement 3: Sign out

**User Story:** As an Authenticated Reader, I want to sign out, so that my session ends on this device.

#### Acceptance Criteria

1. WHEN an Authenticated Reader activates the sign-out control, THE Auth_Client SHALL end the Session within 2 seconds.
2. WHEN an Authenticated Reader activates the sign-out control, THE Auth_Client SHALL discard the Access_Token from device storage.
3. WHEN the Session ends, THE Web_App SHALL present the Anonymous Reader experience within 1 second.
4. WHEN the Session ends, THE Web_App SHALL stop attaching the Access_Token to subsequent API requests.
5. IF the request to end the Session fails, THEN THE Auth_Client SHALL discard the Access_Token from device storage, THE Web_App SHALL present the Anonymous Reader experience, and THE Web_App SHALL display an error indication that the remote Session may still be active.

### Requirement 4: Session handling

**User Story:** As an Authenticated Reader, I want my session to persist across reloads and to be attached to authenticated requests, so that I stay signed in and my actions are authorized.

#### Acceptance Criteria

1. WHEN the Web_App loads AND a stored Session with a valid or refreshable Access_Token is present, THE Web_App SHALL restore the Session and present the Authenticated Reader experience.
2. WHILE a Session is active, THE Web_App SHALL attach the Access_Token as an `Authorization: Bearer` header on every request to an identity or mutating API route.
3. WHILE no Session is active, THE Web_App SHALL send identity and mutating API requests without an `Authorization` header.
4. WHEN an authenticated API request returns HTTP 401, THE Web_App SHALL end the Session, discard the stored Session, and present the Anonymous Reader experience.
5. WHEN Supabase Authentication reports that the Access_Token has expired and a refresh token is available, THE Auth_Client SHALL obtain a new Access_Token and continue the Session.
6. IF the Web_App loads AND the stored Access_Token is expired and cannot be refreshed, THEN THE Web_App SHALL discard the stored Session and present the Anonymous Reader experience.
7. IF no refresh token is available OR a token refresh fails, THEN THE Auth_Client SHALL end the Session and discard the stored Session, and THE Web_App SHALL present the Anonymous Reader experience.

### Requirement 5: Graceful degradation when authentication is not configured

**User Story:** As a Reader running f-Socials offline-first with no authentication configured, I want the app to keep working, so that the absence of auth never breaks the experience.

#### Acceptance Criteria

1. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL display a visible message stating that account features are unavailable and SHALL NOT render the sign-in form.
2. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL keep the home, loading, report, shared-report, and methodology views rendering and responding to user interaction without raising an error.
3. IF a Reader activates the Save_Control WHILE the Web_App is not Auth_Configured, THEN THE Web_App SHALL display the account-features-unavailable message, SHALL NOT send a save request, and SHALL leave the current view unchanged.
4. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL complete initialization and render the home view without raising an unhandled error.
5. IF one or more required values in the Web_App's Supabase configuration are absent or malformed, THEN THE Web_App SHALL treat the condition as not Auth_Configured and SHALL apply the degraded behavior defined in criteria 1 through 4.

### Requirement 6: Wire existing controls to a real session

**User Story:** As an Authenticated Reader, I want the Flag and Save controls to act on my real session, so that I can flag techniques and save reports without an unconditional sign-in prompt.

#### Acceptance Criteria

1. WHILE a Session is active, THE Web_App SHALL present the Flag_Control and Save_Control as enabled and operable and SHALL NOT present a sign-in prompt for them.
2. WHILE no Session is active AND the Web_App is Auth_Configured, IF a Reader activates the Flag_Control or the Save_Control, THEN THE Web_App SHALL present the sign-in flow and SHALL retain the report context and the identity of the activated control.
3. WHEN an Authenticated Reader activates the Flag_Control, THE Web_App SHALL send the flag request to the API with the Access_Token attached.
4. WHEN an Authenticated Reader activates the Save_Control, THE Web_App SHALL send the save request to the API with the Access_Token attached.
5. WHILE a request initiated from the Flag_Control or Save_Control is in progress, THE Web_App SHALL disable the activated control until the request completes.
6. IF a flag or save request fails with a network error or a non-success response other than HTTP 401, THEN THE Web_App SHALL display an error message indicating the action was not recorded and SHALL re-enable the activated control.
7. WHEN the sign-in flow completes successfully after a Reader attempted a gated action, THE Web_App SHALL return the Reader to the report context from which the action was attempted and SHALL present the previously activated control as enabled and operable.

### Requirement 7: Save a report

**User Story:** As an Authenticated Reader, I want to save an analyzed report to my account, so that I can return to it later.

#### Acceptance Criteria

1. WHEN an Authenticated Reader activates the Save_Control on a report, THE Web_App SHALL send a save request for that report identifier with the Access_Token attached.
2. WHEN the API confirms the save within 10 seconds, THE Web_App SHALL display a saved indicator that includes a visible text label (for example "Saved") positioned beside any color or icon signal used to convey the saved state.
3. IF an Authenticated Reader activates the Save_Control on a report that is already saved, THEN THE API SHALL keep exactly one Saved_Report for that Reader and report, and SHALL respond with the same success result as the initial save without creating a duplicate and without returning an error.
4. IF the save request targets a report identifier that does not exist, THEN THE API SHALL respond with HTTP 404 and SHALL NOT create a Saved_Report.
5. IF a save request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 and SHALL NOT create a Saved_Report.
6. WHILE a save request initiated from the Save_Control is in progress, THE Web_App SHALL display a pending state on the Save_Control and SHALL ignore any additional activations of that control until the request resolves.
7. IF a save request fails with an error other than HTTP 404 or HTTP 401, or does not complete within 10 seconds, THEN THE Web_App SHALL display a text message indicating that the save did not complete, SHALL NOT display the saved indicator, and SHALL re-enable the Save_Control so the Reader can retry.

### Requirement 8: Remove a saved report

**User Story:** As an Authenticated Reader, I want to remove a report from my saved list, so that my history reflects what I still care about.

#### Acceptance Criteria

1. WHEN an Authenticated Reader activates the remove control for a Saved_Report, THE Web_App SHALL send a single remove request containing that report's identifier with the Access_Token attached.
2. WHEN the API responds with a success status to a remove request, THE Web_App SHALL exclude that report from the History_View within 2 seconds and without requiring a page reload.
3. IF an Authenticated Reader removes a report that is not currently in the Reader's saved set, THEN THE API SHALL respond with the same success status as a completed removal AND the Reader's saved set SHALL remain unchanged with that report absent.
4. IF a remove request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 AND SHALL NOT modify any Saved_Report.
5. IF the API responds with a non-success status to a remove request, THEN THE Web_App SHALL retain that report in the History_View AND SHALL display an error indication that the removal did not complete.

### Requirement 9: View saved-report history

**User Story:** As an Authenticated Reader, I want to view a list of the reports I have saved, so that I can reopen them.

#### Acceptance Criteria

1. WHEN an Authenticated Reader opens the History_View, THE Web_App SHALL request the Reader's Saved_Reports with the Access_Token attached.
2. WHEN the API returns the Saved_Reports, THE History_View SHALL list them ordered most-recently-saved first, applying a deterministic tie-breaker so reports saved at the same time keep a stable relative order across reloads.
3. WHILE the Reader has zero Saved_Reports, THE History_View SHALL present an empty-state message.
4. WHILE the Reader has one or more Saved_Reports, THE History_View SHALL hide the empty-state message.
5. WHEN a Reader selects an entry in the History_View, THE Web_App SHALL open the full report view for that entry's report.
6. WHEN the API returns a Reader's Saved_Reports, THE API SHALL include only the requesting Reader's reports and SHALL exclude every other Reader's reports.
7. IF a history request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 and SHALL NOT return any Saved_Reports.
8. WHEN an Authenticated Reader saves a report and then opens the History_View, THE History_View SHALL include that report.
9. IF the history request fails or does not complete within 10 seconds, THEN THE History_View SHALL display an error message, SHALL NOT present the empty-state message, and SHALL offer a retry.

### Requirement 10: Account and save/history API routes

**User Story:** As a developer, I want the new API routes to make a deliberate public-versus-authenticated choice, so that identity and mutating routes stay gated.

#### Acceptance Criteria

1. IF a request to the save-report route arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT create a Saved_Report.
2. IF a request to the remove-saved-report route arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT modify any Saved_Report.
3. IF a request to the saved-report-history route arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT return any Saved_Report.
4. WHEN the API validates a save or remove request body or parameters, THE API SHALL reject a malformed request with HTTP 400 through the existing zod validation boundary and SHALL NOT perform any persistence side effect.
5. WHEN the API processes a save, remove, or history request, THE API SHALL scope the operation to the Reader identified by the verified Access_Token and SHALL NOT read, modify, or return another Reader's Saved_Report.
6. IF the API cannot verify an Access_Token because auth verification is unavailable or unconfigured, THEN THE API SHALL respond with HTTP 401 and SHALL NOT return or modify any Saved_Report.
7. WHEN an Authenticated Reader sends a remove request for a report that is not in that Reader's saved set, THE API SHALL NOT delete any other Saved_Report and SHALL respond with a success status.
8. WHEN an Authenticated Reader with no Saved_Reports requests history, THE API SHALL respond with a success status and an empty collection.

### Requirement 11: Persistence through Repository methods and an additive migration

**User Story:** As a maintainer, I want save/history persistence to go through Repository methods and additive schema only, so that the data layer stays consistent and the offline-first path keeps working.

#### Acceptance Criteria

1. THE route handlers SHALL contain no direct database queries for Saved_Report operations and SHALL perform every Saved_Report read and write through Repository methods.
2. THE Repository SHALL provide save/history persistence in both the in-memory implementation and the Postgres implementation, returning equivalent results for identical inputs.
3. WHERE Migration_006 changes the schema, THE Migration_006 SHALL only add schema objects, SHALL preserve every pre-existing row, and SHALL leave every pre-existing route's request and response shape unchanged.
4. THE Migration_006 SHALL apply in lexical order after `005_review_workflow.sql`.
5. THE Postgres Repository SHALL use parameterized SQL with no string interpolation of input values for every Saved_Report operation.
6. WHEN an Authenticated Reader saves a report, removes it, and saves it again, THE Repository SHALL hold exactly one Saved_Report for that Reader and report, leaving the Reader's other Saved_Reports unchanged.
7. WHILE the server runs with the in-memory Repository and no API keys, THE save, remove, and history operations SHALL complete without error and SHALL return the resulting saved set.
8. WHEN the Repository returns a Reader's history, THE Repository SHALL include only that Reader's Saved_Reports.
9. IF a Saved_Report operation fails in the backing store, THEN THE Repository SHALL surface an error indication and SHALL leave existing Saved_Reports unchanged.
10. WHEN an Authenticated Reader removes a report that is not currently saved, THE Repository SHALL leave the Reader's saved set unchanged.

### Requirement 12: Compass neutrality on account surfaces

**User Story:** As a Reader, I want account and history surfaces to remain a lens and not a judge, so that no surface implies a verdict on content or a rating of a creator.

#### Acceptance Criteria

1. WHEN the History_View renders a saved report, THE History_View SHALL NOT display any content-truthfulness verdict for that report.
2. WHEN the History_View renders a saved report, THE History_View SHALL NOT display any reliability rating attached to a content creator, author, person, or channel.
3. WHERE the History_View displays a source-reliability tier, THE History_View SHALL attach that tier to a source or citation only.
4. THE save and history API responses SHALL exclude any field representing a creator-reliability rating.
5. THE save and history API responses SHALL exclude any field representing a content-truthfulness verdict.
6. IF a source-reliability tier in a save or history API response would be associated with a content creator, author, person, or channel rather than a source or citation, THEN THE save and history API SHALL omit that tier from the response.

### Requirement 13: Invariant gate and analysis pipeline untouched

**User Story:** As a maintainer, I want this feature to leave the analysis pipeline and its invariant gate unchanged, so that the codified moat is preserved by construction.

#### Acceptance Criteria

1. THE feature SHALL leave `core/assemble.ts` byte-for-byte identical to its state at the start of this feature, changing zero bytes of its content.
2. THE feature SHALL consume the readiness state (`ready` or `needs_review`) exactly as assigned by the Invariant_Gate and SHALL NOT recompute, override, upgrade, or downgrade it.
3. WHEN a report is saved, removed from an Authenticated Reader's Saved_Reports, or listed in the History_View, THE persisted analysis report content — including its claims, citations, framing signals, and readiness state — SHALL remain byte-for-byte unchanged from its value before the operation.
4. THE feature SHALL NOT add, remove, reorder, or modify any stage of the analysis pipeline that produces or gates a report.

### Requirement 14: Accessibility and web conventions

**User Story:** As a Reader using assistive technology or a small screen, I want the account and history surfaces to meet the app's accessibility and layout conventions, so that the experience stays inclusive.

#### Acceptance Criteria

1. THE Web_App SHALL navigate between the sign-in, sign-out, and history surfaces using URL hash fragments of the form `#/<path>` and SHALL NOT introduce any third-party routing dependency into the web package.
2. WHEN a user operates the sign-in, sign-up, sign-out, Save_Control, or History_View using only a keyboard, THE Web_App SHALL make every interactive control reachable through sequential Tab/Shift+Tab focus order and activatable via the Enter or Space key.
3. WHERE a color or icon conveys state on an account or history surface, THE Web_App SHALL display an adjacent visible text label that conveys the same state without relying on the color or icon.
4. THE Web_App SHALL expose an accessible name and an ARIA role on every interactive control on the account and history surfaces.
5. WHILE the viewport width is at most 768 CSS pixels, THE account and history surfaces SHALL present their content in exactly one column.
6. WHERE the account and history surfaces use an accent color, THE Web_App SHALL use the muted teal `#0d9488`.
7. WHERE the Web_App adds icons to account or history surfaces, THE Web_App SHALL source them from `lucide-react`.
8. WHILE an interactive control on an account or history surface holds keyboard focus, THE Web_App SHALL render a visible focus indicator on that control.
9. WHEN a status message appears on an account or history surface, THE Web_App SHALL expose it through an ARIA live region so assistive technologies announce the message without requiring focus change.
