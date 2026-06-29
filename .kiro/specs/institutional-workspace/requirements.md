# Requirements Document

## Introduction

This feature is the next step of Slice 2 ("Pilots") on the f-Socials roadmap: the **institutional workspace** entry in §5 — *shared collections and classroom annotation*. It builds directly on the just-shipped `accounts-save-history` slice, which gave the web app a real client-side Supabase auth flow (sign up / in / out, session restore + token refresh, `Authorization: Bearer` on identity/mutating calls) and per-reader save + reverse-chronological history (`#/history`, the `reader_saved_reports` store keyed on the Supabase JWT subject).

`accounts-save-history` made f-Socials useful to an **individual** reader. This feature extends the same identity and persistence patterns to a **group**: it gives institutions (educators, libraries, NGOs) a shared space where a group can collect analyzed reports into shared collections and annotate them together. This is the explicit driver behind the §4 P0 validation ("talk to 5–10 educators / libraries / NGOs — would you use this with a group next month?"): the workspace is the surface that conversation is about.

This feature delivers four coupled capabilities:

1. **Workspaces and membership** — an Authenticated Reader can create a Workspace, issue an Invite_Code, and a signed-in Reader can redeem that code to join. Membership is keyed on the Supabase JWT subject, following the migration-006 convention.
2. **Shared collections** — members of a Workspace can create named collections and add analyzed reports to them, so a group curates a shared reading set.
3. **Classroom annotation** — members can attach textual annotations to a report within a Workspace, visible to the group, so the lens can be discussed collaboratively.
4. **Membership-scoped access** — every Workspace operation is `requireAuth`-gated and scoped to the requesting Reader's Membership, so no Reader reads or mutates a Workspace they do not belong to.

The work is account/persistence plus web UI only. It introduces new `Repository` methods (in-memory and Postgres) and one additive database migration (`007`, the next after `006_saved_reports.sql`). It does not touch the invariant gate in `core/assemble.ts`. It honors the Compass — **f-Socials is a lens, not a judge** — so no Workspace surface displays a truthfulness verdict or a creator-reliability rating, and annotation is a Reader-authored note the system never converts into a creator rating or a verdict. It preserves the offline-first path: with no auth configured, Workspace features degrade gracefully and the rest of the app keeps working.

## Glossary

- **Web_App**: The React 19 + Vite web client in `app/apps/web`, using hash routing (`#/...`) with no router dependency.
- **Auth_Client**: The existing client-side module in the Web_App that performs sign up, sign in, and sign out against Supabase Authentication and exposes the current Session.
- **Session**: The authenticated state in the Web_App after a successful sign in, holding the Access_Token and the identified Reader.
- **Reader**: A person using the Web_App, either Anonymous or Authenticated.
- **Access_Token**: The Supabase-issued JWT carried by a Session and sent on authenticated API requests as an `Authorization: Bearer` header. Its subject (`sub`) is the Reader's stable identifier.
- **API**: The Express server in `app/apps/server`, which verifies the Access_Token via `requireAuth` on identity/mutating routes.
- **Workspace**: A named shared space owned by one Authenticated Reader and shared with a set of members, containing Shared_Collections and Annotations.
- **Workspace_Owner**: The Reader who created a Workspace, identified by the JWT subject recorded at creation; holds the Owner Role for that Workspace.
- **Workspace_Member**: A Reader who holds a Membership in a Workspace, with either the Owner Role or the Member Role.
- **Membership**: The association of a Reader's JWT subject with a Workspace and a Role.
- **Role**: One of exactly two values — `owner` or `member`.
- **Invite_Code**: An opaque, redeemable token a Workspace_Owner issues for a Workspace; an Authenticated Reader redeems the Invite_Code to gain a Member Role Membership.
- **Shared_Collection**: A named grouping of analyzed reports within a single Workspace.
- **Collection_Item**: The association of an analyzed report (by report identifier) with a Shared_Collection.
- **Annotation**: A Reader-authored textual note attached to an analyzed report within a Workspace and visible to that Workspace's members.
- **Workspace_View**: The Web_App views under the `#/workspaces` hash path that present Workspaces, Shared_Collections, and Annotations.
- **Report**: An analyzed report already produced and gated by the analysis pipeline; referenced by its existing report identifier.
- **Repository**: The persistence interface in `infra/ports.ts`, implemented in-memory (`infra/memory.ts`) and over Postgres (`infra/postgres.ts`).
- **Migration_007**: The next additive database migration after `006_saved_reports.sql`.
- **Auth_Configured**: The condition that the Web_App has the Supabase URL and anonymous key needed to reach Supabase Authentication.
- **Invariant_Gate**: The report-readiness gate in `core/assemble.ts`; read-only for this feature and never weakened.

## Requirements

### Requirement 1: Create a workspace

**User Story:** As an Authenticated Reader at an institution, I want to create a shared workspace, so that my group has a space to collect and discuss analyzed reports.

#### Acceptance Criteria

1. WHEN an Authenticated Reader submits a workspace-creation request with a name of 1 to 100 characters, THE API SHALL create a Workspace, record the requesting Reader's JWT subject as the Workspace_Owner, and create that Reader's Owner Role Membership.
2. WHEN the API creates a Workspace, THE API SHALL respond with HTTP 201 and the created Workspace's identifier, name, and the requesting Reader's Role.
3. IF a workspace-creation request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT create a Workspace.
4. IF a workspace-creation request carries a name that is empty or longer than 100 characters, THEN THE API SHALL respond with HTTP 400 through the zod validation boundary and SHALL NOT create a Workspace.
5. WHEN the Web_App receives confirmation that a Workspace was created within 10 seconds, THE Web_App SHALL present the new Workspace as selected and SHALL list the requesting Reader as a member with the Owner Role.

### Requirement 2: Issue and redeem invitations

**User Story:** As a Workspace_Owner, I want to issue an invite code that a colleague can redeem, so that I can add members without an email directory.

#### Acceptance Criteria

1. WHEN a Workspace_Owner requests an Invite_Code for a Workspace, THE API SHALL generate an Invite_Code bound to that Workspace and respond with the Invite_Code value.
2. IF a Reader who holds the Member Role, or who holds no Membership in the target Workspace, requests an Invite_Code, THEN THE API SHALL respond with HTTP 403 and SHALL NOT generate an Invite_Code.
3. WHEN an Authenticated Reader redeems a valid Invite_Code, THE API SHALL create a Member Role Membership for that Reader's JWT subject in the bound Workspace and respond with the Workspace identifier and the Member Role.
4. IF an Authenticated Reader redeems an Invite_Code that does not match any Workspace, THEN THE API SHALL respond with HTTP 404 and SHALL NOT create a Membership.
5. IF an Authenticated Reader who already holds a Membership in the bound Workspace redeems an Invite_Code for that Workspace, THEN THE API SHALL keep exactly one Membership for that Reader and Workspace, SHALL leave the existing Role unchanged, and SHALL respond with a success status without creating a duplicate.
6. IF an Invite_Code redemption request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT create a Membership.

### Requirement 3: Manage membership

**User Story:** As a Workspace_Owner, I want to see and remove members, so that I control who shares the workspace.

#### Acceptance Criteria

1. WHEN a Workspace_Member requests the member list of a Workspace in which that Reader holds a Membership, THE API SHALL return each Membership's JWT subject and Role for that Workspace and SHALL exclude every Membership of every other Workspace.
2. WHEN a Workspace_Owner removes a Workspace_Member who holds the Member Role, THE API SHALL delete that Reader's Membership and respond with a success status.
3. IF a Reader who holds the Member Role attempts to remove any Membership, THEN THE API SHALL respond with HTTP 403 and SHALL leave every Membership unchanged.
4. IF a Workspace_Owner attempts to remove the Workspace_Owner's own Membership, THEN THE API SHALL respond with HTTP 400 and SHALL leave the Owner Membership unchanged.
5. WHEN a Workspace_Member's Membership is removed, THE API SHALL stop returning that Workspace to that Reader in the Reader's workspace list and SHALL reject that Reader's subsequent operations on the Workspace with HTTP 403.

### Requirement 4: List a reader's workspaces

**User Story:** As a Workspace_Member, I want to see the workspaces I belong to, so that I can switch between my groups.

#### Acceptance Criteria

1. WHEN an Authenticated Reader requests the Reader's workspace list, THE API SHALL return every Workspace in which that Reader holds a Membership, each with the Workspace identifier, name, and the Reader's Role.
2. WHEN the API returns a Reader's workspace list, THE API SHALL exclude every Workspace in which the Reader holds no Membership.
3. WHILE the Reader holds no Membership in any Workspace, THE API SHALL respond with a success status and an empty collection.
4. IF a workspace-list request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT return any Workspace.
5. WHEN the Web_App opens the Workspace_View AND the Reader holds zero Memberships, THE Workspace_View SHALL present an empty-state message and SHALL offer the workspace-creation control.

### Requirement 5: Create and list shared collections

**User Story:** As a Workspace_Member, I want to create named collections in my workspace, so that the group can organize reports by topic or class.

#### Acceptance Criteria

1. WHEN a Workspace_Member submits a collection-creation request with a name of 1 to 100 characters for a Workspace in which the Reader holds a Membership, THE API SHALL create a Shared_Collection in that Workspace and respond with the Shared_Collection identifier and name.
2. WHEN a Workspace_Member requests the Shared_Collections of a Workspace in which the Reader holds a Membership, THE API SHALL return every Shared_Collection of that Workspace and SHALL exclude every Shared_Collection of every other Workspace.
3. IF a Reader who holds no Membership in the target Workspace requests or creates a Shared_Collection, THEN THE API SHALL respond with HTTP 403 and SHALL NOT create or return any Shared_Collection.
4. IF a collection-creation request carries a name that is empty or longer than 100 characters, THEN THE API SHALL respond with HTTP 400 through the zod validation boundary and SHALL NOT create a Shared_Collection.
5. WHEN a Workspace_Owner deletes a Shared_Collection in the Owner's Workspace, THE API SHALL delete that Shared_Collection together with its Collection_Items and respond with a success status.
6. IF a Reader who holds the Member Role attempts to delete a Shared_Collection, THEN THE API SHALL respond with HTTP 403 and SHALL leave the Shared_Collection unchanged.

### Requirement 6: Add and remove reports in a collection

**User Story:** As a Workspace_Member, I want to add analyzed reports to a shared collection and remove them, so that the group's reading set reflects what we are studying.

#### Acceptance Criteria

1. WHEN a Workspace_Member adds a Report by identifier to a Shared_Collection in a Workspace in which the Reader holds a Membership, THE API SHALL create a Collection_Item linking that Report to the Shared_Collection and respond with a success status.
2. IF a Workspace_Member adds a Report that is already a Collection_Item of the target Shared_Collection, THEN THE API SHALL keep exactly one Collection_Item for that Report and Shared_Collection and SHALL respond with the same success result as the initial add without creating a duplicate.
3. IF an add request targets a report identifier that does not exist, THEN THE API SHALL respond with HTTP 404 and SHALL NOT create a Collection_Item.
4. WHEN a Workspace_Member requests the Collection_Items of a Shared_Collection in the Reader's Workspace, THE API SHALL return the contained report identifiers ordered most-recently-added first, applying a deterministic tie-breaker so items added at the same time keep a stable relative order across reloads.
5. WHEN a Workspace_Member removes a Report from a Shared_Collection in the Reader's Workspace, THE API SHALL delete that Collection_Item and respond with a success status.
6. IF a Workspace_Member removes a Report that is not a Collection_Item of the target Shared_Collection, THEN THE API SHALL respond with the same success status as a completed removal AND SHALL leave every other Collection_Item unchanged.
7. IF a Reader who holds no Membership in the Workspace that owns the Shared_Collection adds to, reads, or removes from that Shared_Collection, THEN THE API SHALL respond with HTTP 403 and SHALL NOT read or modify any Collection_Item.

### Requirement 7: Annotate a report within a workspace

**User Story:** As a Workspace_Member in a classroom, I want to attach a note to a report and read my group's notes, so that we can discuss the framing and evidence together.

#### Acceptance Criteria

1. WHEN a Workspace_Member submits an Annotation of 1 to 4000 characters on a Report within a Workspace in which the Reader holds a Membership, THE API SHALL create an Annotation recording the Report identifier, the Workspace identifier, the author's JWT subject, the text, and the creation time, and respond with the created Annotation.
2. WHEN a Workspace_Member requests the Annotations for a Report within a Workspace in which the Reader holds a Membership, THE API SHALL return every Annotation attached to that Report in that Workspace ordered most-recently-created first with a deterministic tie-breaker, and SHALL exclude every Annotation of every other Workspace.
3. WHEN the author of an Annotation edits that Annotation's text to 1 to 4000 characters, THE API SHALL update the Annotation text and respond with a success status.
4. IF a Reader who is not the author of an Annotation and does not hold the Owner Role in the Annotation's Workspace attempts to edit or delete that Annotation, THEN THE API SHALL respond with HTTP 403 and SHALL leave the Annotation unchanged.
5. WHEN the author of an Annotation, or the Workspace_Owner of the Annotation's Workspace, deletes that Annotation, THE API SHALL delete the Annotation and respond with a success status.
6. IF an Annotation create or edit request carries text that is empty or longer than 4000 characters, THEN THE API SHALL respond with HTTP 400 through the zod validation boundary and SHALL NOT create or modify any Annotation.
7. IF an Annotation create request targets a report identifier that does not exist, THEN THE API SHALL respond with HTTP 404 and SHALL NOT create an Annotation.
8. IF a Reader who holds no Membership in the target Workspace creates, reads, edits, or deletes an Annotation in that Workspace, THEN THE API SHALL respond with HTTP 403 and SHALL NOT read or modify any Annotation.

### Requirement 8: Workspace API routes and access scoping

**User Story:** As a developer, I want every workspace route to make a deliberate authentication and membership choice, so that identity and mutating routes stay gated and scoped.

#### Acceptance Criteria

1. IF a request to any workspace, collection, collection-item, membership, invitation, or annotation route arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT read or modify any Workspace data.
2. WHEN the API processes a workspace-scoped request from an Authenticated Reader who holds no Membership in the target Workspace, THE API SHALL respond with HTTP 403 and SHALL NOT read, modify, or return that Workspace's data.
3. WHEN the API processes an owner-only operation requested by a Reader who holds the Member Role, THE API SHALL respond with HTTP 403 and SHALL NOT perform the operation.
4. WHEN the API validates a workspace, collection, collection-item, membership, invitation, or annotation request body or parameters, THE API SHALL reject a malformed request with HTTP 400 through the existing zod validation boundary and SHALL NOT perform any persistence side effect.
5. WHEN the API processes any workspace-scoped operation, THE API SHALL scope the operation to the Workspace and Role established by the requesting Reader's verified Membership and SHALL NOT read, modify, or return data belonging to a Workspace in which the Reader holds no Membership.
6. IF the API cannot verify an Access_Token because auth verification is unavailable or unconfigured, THEN THE API SHALL respond with HTTP 401 and SHALL NOT read, modify, or return any Workspace data.
7. WHERE the target Workspace identifier matches no existing Workspace, THE API SHALL respond with HTTP 404 and SHALL NOT return Workspace data.

### Requirement 9: Persistence through Repository methods and an additive migration

**User Story:** As a maintainer, I want workspace persistence to go through Repository methods and additive schema only, so that the data layer stays consistent and the offline-first path keeps working.

#### Acceptance Criteria

1. THE route handlers SHALL contain no direct database queries for Workspace, Membership, Invite_Code, Shared_Collection, Collection_Item, or Annotation operations and SHALL perform every such read and write through Repository methods.
2. THE Repository SHALL provide the Workspace persistence operations in both the in-memory implementation and the Postgres implementation, returning equivalent results for identical inputs.
3. WHERE Migration_007 changes the schema, THE Migration_007 SHALL only add schema objects, SHALL preserve every pre-existing row, and SHALL leave every pre-existing route's request and response shape unchanged.
4. THE Migration_007 SHALL apply in lexical order after `006_saved_reports.sql`.
5. THE Migration_007 SHALL key each Membership on the Reader's Supabase JWT subject stored as TEXT, following the convention established by `006_saved_reports.sql`.
6. THE Postgres Repository SHALL use parameterized SQL with no string interpolation of input values for every Workspace operation in every environment, including development and test environments.
7. WHEN a Reader adds a Report to a Shared_Collection, removes the Report, and adds the Report again, THE Repository SHALL hold exactly one Collection_Item for that Report and Shared_Collection, leaving the Shared_Collection's other Collection_Items unchanged.
8. WHEN the Repository returns a Workspace's Shared_Collections, Collection_Items, members, or Annotations, THE Repository SHALL include only data belonging to that Workspace.
9. IF a Workspace operation fails in the backing store, THEN THE Repository SHALL surface an error indication and SHALL leave existing Workspace data unchanged.
10. WHILE the server runs with the in-memory Repository and no API keys, THE Workspace, collection, annotation, and membership operations SHALL complete without error and SHALL return the resulting state.

### Requirement 10: Compass neutrality on workspace surfaces

**User Story:** As a Reader, I want workspace, collection, and annotation surfaces to remain a lens and not a judge, so that no shared surface implies a verdict on content or a rating of a creator.

#### Acceptance Criteria

1. WHEN a Workspace_View renders a Report inside a Shared_Collection or annotation context, THE Workspace_View SHALL NOT display any content-truthfulness verdict for that Report.
2. WHEN a Workspace_View renders a Report, an Annotation, or a member, THE Workspace_View SHALL NOT display any reliability rating attached to a content creator, author, person, or channel.
3. WHERE a Workspace_View displays a source-reliability tier, THE Workspace_View SHALL attach that tier to a source or citation only.
4. THE Annotation data model SHALL carry only the author's JWT subject, the Workspace identifier, the Report identifier, the textual note, and timestamps, and SHALL exclude any field representing a creator-reliability rating or a content-truthfulness verdict.
5. THE workspace, collection, collection-item, membership, and annotation API responses SHALL exclude any field representing a creator-reliability rating and any field representing a content-truthfulness verdict.
6. WHEN a Workspace_View presents an Annotation, THE Workspace_View SHALL attribute the Annotation to its authoring Reader as a note and SHALL NOT present the Annotation as a system-issued verdict or a creator rating.

### Requirement 11: Invariant gate and analysis pipeline untouched

**User Story:** As a maintainer, I want this feature to leave the analysis pipeline and its invariant gate unchanged, so that the codified moat is preserved by construction.

#### Acceptance Criteria

1. THE feature SHALL leave `core/assemble.ts` byte-for-byte identical to its state at the start of this feature, changing zero bytes of the content of `core/assemble.ts`.
2. THE feature SHALL consume the readiness state (`ready` or `needs_review`) exactly as assigned by the Invariant_Gate and SHALL NOT recompute, override, upgrade, or downgrade the readiness state.
3. WHEN a Report is added to, removed from, or read within a Shared_Collection, annotated, or listed in a Workspace_View, THE persisted analysis report content — including its claims, citations, framing signals, and readiness state — SHALL remain byte-for-byte unchanged from the value before the operation.
4. THE feature SHALL NOT add, remove, reorder, or modify any stage of the analysis pipeline that produces or gates a Report.

### Requirement 12: Graceful degradation when authentication is not configured

**User Story:** As a Reader running f-Socials offline-first with no authentication configured, I want the app to keep working, so that the absence of auth never breaks the experience.

#### Acceptance Criteria

1. WHILE the Web_App is not Auth_Configured, THE Workspace_View SHALL display a visible message stating that workspace features are unavailable and SHALL NOT render the workspace-creation form or the invite-redemption form.
2. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL keep the home, loading, report, shared-report, methodology, and history views rendering and responding to user interaction without raising an error.
3. IF a Reader activates a workspace, collection, or annotation control WHILE the Web_App is not Auth_Configured, THEN THE Web_App SHALL display the workspace-features-unavailable message, SHALL NOT send a request, and SHALL leave the current view unchanged.
4. WHILE the Web_App is not Auth_Configured, THE Web_App SHALL complete initialization and render the home view without raising an unhandled error.
5. IF one or more required values in the Web_App's Supabase configuration are absent or malformed, THEN THE Web_App SHALL treat the condition as not Auth_Configured and SHALL apply the degraded behavior defined in criteria 1 through 4.

### Requirement 13: Web navigation and session wiring

**User Story:** As a Workspace_Member, I want to reach workspace surfaces through the app's hash routes with my real session attached, so that my actions are authorized and my session persists.

#### Acceptance Criteria

1. THE Web_App SHALL navigate to the workspace surfaces using URL hash fragments of the form `#/workspaces` and `#/workspaces/<id>` and SHALL NOT introduce any third-party routing dependency into the web package.
2. WHILE a Session is active, THE Web_App SHALL attach the Access_Token as an `Authorization: Bearer` header on every request to a workspace, collection, collection-item, membership, invitation, or annotation route.
3. WHILE a Session is active, IF a workspace request is about to be issued without the `Authorization: Bearer` header, THEN THE Web_App SHALL attach the current Access_Token and issue the request with the header rather than sending the request unauthenticated.
4. WHILE no Session is active AND the Web_App is Auth_Configured, IF a Reader opens a Workspace_View, THEN THE Web_App SHALL present the sign-in flow and SHALL retain the target Workspace_View so the Reader returns to it after signing in.
5. WHEN a workspace API request returns HTTP 401, THE Web_App SHALL end the Session and present the Anonymous Reader experience, consistent with the existing session-handling behavior.
6. WHEN a workspace API request returns HTTP 403, THE Web_App SHALL display a message indicating the Reader lacks access to the requested Workspace and SHALL NOT present the requested Workspace's data.

### Requirement 14: Accessibility and web conventions

**User Story:** As a Reader using assistive technology or a small screen, I want the workspace surfaces to meet the app's accessibility and layout conventions, so that the shared experience stays inclusive.

#### Acceptance Criteria

1. WHEN a Reader operates the workspace, collection, collection-item, invitation, and annotation controls using only a keyboard, THE Web_App SHALL make every interactive control reachable through sequential Tab and Shift+Tab focus order and activatable via the Enter or Space key.
2. WHERE a color or icon conveys state on a Workspace_View, THE Web_App SHALL display an adjacent visible text label that conveys the same state without relying on the color or icon.
3. THE Web_App SHALL expose an accessible name and an ARIA role on every interactive control on the Workspace_View.
4. WHILE the viewport width is at least 200 CSS pixels and at most 768 CSS pixels, THE Workspace_View SHALL present its content in exactly one column.
5. WHERE a Workspace_View uses an accent color, THE Web_App SHALL use the muted teal `#0d9488`.
6. WHERE the Web_App adds icons to a Workspace_View, THE Web_App SHALL source the icons from `lucide-react`.
7. WHILE an interactive control on a Workspace_View holds keyboard focus, THE Web_App SHALL render a visible focus indicator on that control.
8. WHEN a status message appears on a Workspace_View, THE Web_App SHALL expose the message through an ARIA live region so assistive technologies announce the message without requiring a focus change.
