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

1. WHEN an Anonymous Reader submits the sign-up form with an email and a password, THE Auth_Client SHALL request account creation from Supabase Authentication.
2. WHEN Supabase Authentication confirms account creation and returns an Access_Token, THE Web_App SHALL establish a Session for the Reader.
3. IF Supabase Authentication rejects the sign-up request, THEN THE Web_App SHALL display the returned error message and SHALL leave the Reader Anonymous.
4. WHILE a sign-up request is in flight, THE Web_App SHALL disable the sign-up submit control.
5. IF the submitted email is empty or the submitted password is empty, THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.

### Requirement 2: Sign in

**User Story:** As an Anonymous Reader with an account, I want to sign in, so that my session is restored and account features become available.

#### Acceptance Criteria

1. WHEN an Anonymous Reader submits the sign-in form with an email and a password, THE Auth_Client SHALL request a session from Supabase Authentication.
2. WHEN Supabase Authentication returns an Access_Token, THE Web_App SHALL establish a Session for the Reader.
3. IF Supabase Authentication rejects the credentials, THEN THE Web_App SHALL display an authentication-failed message and SHALL leave the Reader Anonymous.
4. WHILE a sign-in request is in flight, THE Web_App SHALL disable the sign-in submit control.
5. IF the submitted email is empty or the submitted password is empty, THEN THE Web_App SHALL display a validation message and SHALL NOT send the request.

### Requirement 3: Sign out

**User Story:** As an Authenticated Reader, I want to sign out, so that my session ends on this device.

#### Acceptance Criteria

1. WHEN an Authenticated Reader activates the sign-out control, THE Auth_Client SHALL end the Session and discard the Access_Token.
2. WHEN the Session ends, THE Web_App SHALL present the Anonymous Reader experience.
3. WHEN the Session ends, THE Web_App SHALL stop attaching the Access_Token to subsequent API requests.

### Requirement 4: Session handling

**User Story:** As an Authenticated Reader, I want my session to persist across reloads and to be attached to authenticated requests, so that I stay signed in and my actions are authorized.

#### Acceptance Criteria

1. WHEN the Web_App loads AND a stored Session is present, THE Web_App SHALL restore the Session and present the Authenticated Reader experience.
2. WHILE a Session is active, THE Web_App SHALL attach the Access_Token as an `Authorization: Bearer` header on every request to an identity or mutating API route.
3. WHILE no Session is active, THE Web_App SHALL send identity and mutating API requests without an `Authorization` header.
4. WHEN an authenticated API request returns HTTP 401, THE Web_App SHALL end the Session and present the Anonymous Reader experience.
5. WHEN Supabase Authentication reports that the Access_Token has expired and a refresh token is available, THE Auth_Client SHALL obtain a new Access_Token and continue the Session.

### Requirement 5: Graceful degradation when authentication is not configured

**User Story:** As a Reader running f-Socials offline-first with no authentication configured, I want the app to keep working, so that the absence of auth never breaks the experience.

#### Acceptance Criteria

1. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL present a message that account features are unavailable instead of the sign-in form.
2. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL keep the home, loading, report, shared-report, and methodology views fully operable.
3. IF a Reader activates the Save_Control WHILE the Web_App is not Auth_Configured, THEN THE Web_App SHALL display the account-features-unavailable message and SHALL NOT send a save request.
4. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL load without raising an unhandled error during initialization.

### Requirement 6: Wire existing controls to a real session

**User Story:** As an Authenticated Reader, I want the Flag and Save controls to act on my real session, so that I can flag techniques and save reports without an unconditional sign-in prompt.

#### Acceptance Criteria

1. WHILE a Session is active, THE Web_App SHALL present the Flag_Control and Save_Control as actionable rather than presenting an unconditional sign-in prompt.
2. WHILE no Session is active AND the Web_App is Auth_Configured, IF a Reader activates the Flag_Control or the Save_Control, THEN THE Web_App SHALL present the sign-in flow.
3. WHEN an Authenticated Reader activates the Flag_Control, THE Web_App SHALL send the flag request with the Access_Token attached.
4. WHEN the sign-in flow completes successfully after a Reader attempted a gated action, THE Web_App SHALL return the Reader to the report context from which the action was attempted.

### Requirement 7: Save a report

**User Story:** As an Authenticated Reader, I want to save an analyzed report to my account, so that I can return to it later.

#### Acceptance Criteria

1. WHEN an Authenticated Reader activates the Save_Control on a report, THE Web_App SHALL send a save request for that report identifier with the Access_Token attached.
2. WHEN the API confirms the save, THE Web_App SHALL indicate that the report is saved, with a text label beside any color or icon signal.
3. IF an Authenticated Reader activates the Save_Control on a report that is already saved, THEN THE API SHALL keep exactly one Saved_Report for that Reader and report.
4. IF the save request targets a report identifier that does not exist, THEN THE API SHALL respond with HTTP 404 and SHALL NOT create a Saved_Report.
5. IF a save request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 and SHALL NOT create a Saved_Report.

### Requirement 8: Remove a saved report

**User Story:** As an Authenticated Reader, I want to remove a report from my saved list, so that my history reflects what I still care about.

#### Acceptance Criteria

1. WHEN an Authenticated Reader removes a Saved_Report, THE Web_App SHALL send a remove request for that report identifier with the Access_Token attached.
2. WHEN the API confirms the removal, THE Web_App SHALL exclude that report from the History_View.
3. IF an Authenticated Reader removes a report that is not currently saved, THEN THE API SHALL respond with success and the Reader's saved set SHALL remain without that report.
4. IF a remove request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 and SHALL NOT modify any Saved_Report.

### Requirement 9: View saved-report history

**User Story:** As an Authenticated Reader, I want to view a list of the reports I have saved, so that I can reopen them.

#### Acceptance Criteria

1. WHEN an Authenticated Reader opens the History_View, THE Web_App SHALL request the Reader's Saved_Reports with the Access_Token attached.
2. WHEN the API returns the Saved_Reports, THE History_View SHALL list them ordered most-recently-saved first.
3. WHILE the Reader has no Saved_Reports, THE History_View SHALL present an empty-state message.
4. WHEN a Reader selects an entry in the History_View, THE Web_App SHALL open that report.
5. THE API SHALL return only the requesting Reader's Saved_Reports.
6. IF a history request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401.
7. WHEN an Authenticated Reader saves a report and then opens the History_View, THE History_View SHALL include that report.

### Requirement 10: Account and save/history API routes

**User Story:** As a developer, I want the new API routes to make a deliberate public-versus-authenticated choice, so that identity and mutating routes stay gated.

#### Acceptance Criteria

1. THE API SHALL gate the save-report route behind `requireAuth`.
2. THE API SHALL gate the remove-saved-report route behind `requireAuth`.
3. THE API SHALL gate the saved-report-history route behind `requireAuth`.
4. WHEN the API validates a save or remove request body or parameters, THE API SHALL reject a malformed request with HTTP 400 using the existing zod validation boundary.
5. WHEN the API processes a save, remove, or history request, THE API SHALL scope persistence to the Reader identified by the verified Access_Token.

### Requirement 11: Persistence through Repository methods and an additive migration

**User Story:** As a maintainer, I want save/history persistence to go through Repository methods and additive schema only, so that the data layer stays consistent and the offline-first path keeps working.

#### Acceptance Criteria

1. THE API SHALL persist and read Saved_Reports only through Repository methods, not ad-hoc queries in route handlers.
2. THE Repository SHALL provide save/history persistence in both the in-memory implementation and the Postgres implementation.
3. WHERE Migration_006 changes the schema, THE Migration_006 SHALL be additive and SHALL preserve every existing row and existing route contract.
4. THE Migration_006 SHALL apply in lexical order after `005_review_workflow.sql`.
5. THE Postgres Repository SHALL use parameterized SQL for every Saved_Report operation.
6. WHEN an Authenticated Reader saves a report, removes it, and saves it again, THE Repository SHALL hold exactly one Saved_Report for that Reader and report.
7. WHILE the server runs with the in-memory Repository and no API keys, THE save, remove, and history operations SHALL function.

### Requirement 12: Compass neutrality on account surfaces

**User Story:** As a Reader, I want account and history surfaces to remain a lens and not a judge, so that no surface implies a verdict on content or a rating of a creator.

#### Acceptance Criteria

1. THE History_View SHALL NOT display a truthfulness verdict for any saved report.
2. THE History_View SHALL NOT display a reliability rating attached to a content creator or channel.
3. WHERE the History_View shows a source-reliability tier, THE History_View SHALL attach that tier to a source or citation only.
4. THE save and history API responses SHALL exclude any creator-reliability rating and any content-truthfulness verdict field.

### Requirement 13: Invariant gate and analysis pipeline untouched

**User Story:** As a maintainer, I want this feature to leave the analysis pipeline and its invariant gate unchanged, so that the codified moat is preserved by construction.

#### Acceptance Criteria

1. THE feature SHALL NOT modify `core/assemble.ts`.
2. THE feature SHALL read report readiness as already determined by the Invariant_Gate and SHALL NOT recompute or alter it.
3. WHEN a report is saved, removed, or listed, THE persisted analysis report content SHALL remain byte-for-byte unchanged.

### Requirement 14: Accessibility and web conventions

**User Story:** As a Reader using assistive technology or a small screen, I want the account and history surfaces to meet the app's accessibility and layout conventions, so that the experience stays inclusive.

#### Acceptance Criteria

1. THE Web_App SHALL route the sign-in, sign-out, and history surfaces using hash routing without adding a router dependency.
2. THE sign-in, sign-up, sign-out, Save_Control, and History_View SHALL be fully operable by keyboard.
3. WHERE a color or icon conveys state on an account or history surface, THE Web_App SHALL present an accompanying text label.
4. THE account and history surfaces SHALL expose ARIA roles and labels on interactive controls and status messages.
5. WHILE the viewport width is at most 768 pixels, THE account and history surfaces SHALL present a single-column layout.
6. WHERE the account and history surfaces use an accent color, THE Web_App SHALL use the muted teal `#0d9488`.
7. WHERE the Web_App adds icons to account or history surfaces, THE Web_App SHALL source them from `lucide-react`.
