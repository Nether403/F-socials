# Requirements Document

## Introduction

f-Socials authenticates readers with Supabase JWTs (`@supabase/supabase-js` on the web, `requireAuth` + `verifyJwt` on the server). The verified identity carries the Supabase auth subject (`sub`), an optional email, and an optional role. Two persistence seams deliberately key on this **subject as `TEXT`** and need no local user record: saved reports (`reader_saved_reports`, migration 006) and institutional workspaces (the `007` tables). Those are explicitly **out of scope** here and must not change.

One legacy seam still keys on the original `users(id)` UUID: the community **flag** (`flags.user_id UUID NOT NULL REFERENCES users(id)`). The authenticated flag route persists `req.user.id` — the Supabase subject — into `flags.user_id`. Under the Postgres driver this insert violates the foreign key, because no `users` row exists for that subject; the in-memory driver has no foreign key and silently accepts it. The dispute intake is anonymous today (`disputes.raised_by` is always `NULL`) and shares the same `users(id)` reference seam should an authenticated dispute ever attach an identity.

This feature closes that seam. When an authenticated Supabase user performs an **identity-bearing action** (today: submitting a flag), the system ensures a corresponding row exists in the local `users` table, keyed to the JWT subject, so the dependent record references a real, synced local user. The synced record is derived solely from the already-verified token claims — no additional Supabase round-trip — so the offline-first path (zero API keys → mock providers + in-memory infra) keeps working and no new network dependency is introduced. The work is additive: new `Repository` methods and an additive migration; the invariant gate in `core/assemble.ts` is never touched, and no synced field expresses a verdict about content or a rating of a creator.

## Glossary

- **Auth_User**: The verified identity extracted from a Supabase JWT by `verifyJwt`, comprising the **Subject**, an optional email, and an optional role.
- **Subject**: The Supabase JWT `sub` claim (a UUID string) that uniquely identifies the authenticated Supabase user.
- **Local_User**: A row in the local `users` table (`id`, `email`, `display_name`, `role`, `org_id`, `prefs`, `created_at`).
- **User_Sync**: The capability that ensures a Local_User keyed to a given Subject exists, derived from Auth_User claims.
- **Identity_Bearing_Action**: An authenticated action that persists a record referencing the local `users` table. The current instance is submitting a **Flag**.
- **Flag**: The authenticated technique flag persisted via `Repository.createFlag` into the `flags` table, whose `user_id` references `users(id)`.
- **Dispute**: The anonymous report-challenge intake persisted via `Repository.createDispute`; its `raised_by` is currently always `NULL`.
- **Saved_Report**: A reader's saved report, keyed on the Subject as `TEXT` (out of scope, must not change).
- **Workspace_Record**: Institutional-workspace persistence, keyed on the Subject as `TEXT` (out of scope, must not change).
- **Repository**: The persistence seam (`src/infra/ports.ts`) with an in-memory implementation and a Postgres implementation, selected by `.env` flags in `compose.ts`.
- **Offline_Mode**: The configuration with no Supabase / external keys, where the server falls back to mock providers and in-memory infrastructure.
- **Invariant_Gate**: The report-readiness gate in `core/assemble.ts` that must not be weakened.

## Requirements

### Requirement 1: Ensure a synced local user for identity-bearing actions

**User Story:** As an authenticated reader, I want the system to keep a local user record matching my Supabase identity, so that the records I create (such as flags) reference a real, synced user.

#### Acceptance Criteria

1. WHEN an Auth_User performs an Identity_Bearing_Action, THE User_Sync SHALL, before the dependent record is persisted, ensure a Local_User keyed to the Auth_User Subject exists by reusing the Local_User already keyed to that Subject or creating one when none exists.
2. THE User_Sync SHALL set the Local_User identifier equal to the Auth_User Subject so that a dependent record referencing that Subject (a Flag's `user_id`) resolves to the Local_User.
3. THE User_Sync SHALL derive every Local_User field solely from the verified Auth_User claims and SHALL NOT issue any request to Supabase or any other external service during the sync.
4. WHERE the Auth_User claims include an email, THE User_Sync SHALL store that email value on the Local_User.
5. WHERE the Auth_User claims include a role, THE User_Sync SHALL store that role value on the Local_User.

### Requirement 2: Idempotent upsert semantics

**User Story:** As an operator, I want repeated syncs of the same user to be safe, so that no duplicate local users accumulate and existing data stays stable.

#### Acceptance Criteria

1. THE User_Sync SHALL maintain at most one Local_User per Subject.
2. WHEN User_Sync runs for a Subject, IF a Local_User keyed to that Subject already exists, THEN THE User_Sync SHALL keep that single existing Local_User without creating a duplicate.
3. WHEN User_Sync runs for a Subject, IF a Local_User keyed to that Subject already exists, THEN THE User_Sync SHALL preserve that Local_User's Subject key and its original `created_at` timestamp.
4. WHEN User_Sync runs for a Subject, IF a Local_User keyed to that Subject already exists and its stored email or role differs from the current Auth_User claims, THEN THE User_Sync SHALL update the stored email or role to match the Auth_User claims while preserving the Subject key and the original `created_at` timestamp.
5. WHEN User_Sync runs for a Subject whose existing Local_User has a stored email or role and the current Auth_User claims omit that email or role, THE User_Sync SHALL retain the previously stored value rather than clearing it.
6. WHILE two or more User_Sync operations for the same Subject run concurrently, THE User_Sync SHALL result in at most one Local_User for that Subject.

### Requirement 3: The flag flow consumes the synced record

**User Story:** As an authenticated reader, I want to flag a manipulation technique, so that my flag is persisted against a valid local user reference.

#### Acceptance Criteria

1. WHEN an Auth_User submits a Flag whose payload passes trust-boundary validation, THE System SHALL ensure a Local_User keyed to the Auth_User Subject exists before attempting to persist the Flag.
2. WHEN an Auth_User submits a Flag whose payload passes trust-boundary validation and the Local_User is ensured, THE System SHALL persist the Flag with its user reference equal to that Local_User's identifier so that the reference resolves to the Local_User under both the in-memory and Postgres Repository drivers.
3. WHEN an Auth_User submits a Flag whose payload passes trust-boundary validation and persistence succeeds, THE System SHALL respond with the same success result produced by the existing flag flow and SHALL preserve the existing flag idempotency behavior unchanged.
4. IF the submitted Flag payload fails trust-boundary validation, THEN THE System SHALL reject the submission with a client-error response and SHALL NOT invoke User_Sync and SHALL NOT persist the Flag.

### Requirement 4: Scope boundary — subject-keyed flows are unchanged

**User Story:** As a maintainer, I want the deliberate subject-keyed seams to stay as they are, so that this feature does not regress saved reports or workspaces.

#### Acceptance Criteria

1. THE Saved_Report persistence SHALL continue to reference the Subject as `TEXT` and SHALL neither create nor require a Local_User row keyed to that Subject.
2. THE Workspace_Record persistence SHALL continue to reference the Subject as `TEXT` and SHALL neither create nor require a Local_User row keyed to that Subject.
3. WHEN a Saved_Report or Workspace_Record create, read, list, update, or delete operation is performed for a Subject, THE System SHALL complete it with its existing result and SHALL NOT invoke User_Sync.
4. WHEN a Dispute is submitted, THE System SHALL persist it with its `raised_by` reference set to NULL and SHALL create no Local_User reference.
5. WHEN a Dispute is submitted, THE System SHALL complete the intake without invoking User_Sync.

### Requirement 5: Local user validity when email is absent

**User Story:** As an authenticated reader without an email claim, I want my flag to still work, so that identity sync does not depend on optional token fields.

#### Acceptance Criteria

1. IF the Auth_User claims carry no email, THEN THE User_Sync SHALL create a Local_User keyed to the Subject with its email stored as absent (null) and SHALL persist that Local_User without error.
2. WHEN two or more distinct Subjects are synced with no email claim, THE User_Sync SHALL keep each as a separate Local_User identified by its own Subject, treating an absent email as a non-colliding value so that no email-uniqueness conflict rejects the second or any subsequent sync.
3. WHEN an Auth_User with no email claim submits a Flag, THE System SHALL persist the Flag with its user reference resolving to the email-absent Local_User keyed to that Subject, returning the existing flag success result.

### Requirement 6: Failure isolation — no orphaned dependent record

**User Story:** As an operator, I want a sync failure to fail the action cleanly, so that no flag is persisted without a valid user reference.

#### Acceptance Criteria

1. IF User_Sync fails to persist the Local_User, THEN THE System SHALL reject the Identity_Bearing_Action with an error response that indicates a server-side failure and signals to the caller that the action did not complete, without exposing internal sync details.
2. IF User_Sync fails to persist the Local_User, THEN THE System SHALL NOT persist the dependent record.
3. IF User_Sync fails to persist the Local_User, THEN THE System SHALL leave persisted data in its pre-action state, retaining no partial Local_User and no dependent record from the failed Identity_Bearing_Action.

### Requirement 7: Both drivers and offline-first parity

**User Story:** As a developer, I want User_Sync available behind the Repository seam in both drivers, so that the offline-first path keeps working with zero configuration.

#### Acceptance Criteria

1. THE Repository SHALL expose User_Sync in both the in-memory implementation and the Postgres implementation.
2. WHEN given identical inputs, THE in-memory User_Sync and the Postgres User_Sync SHALL each maintain exactly one Local_User per Subject, with the stored email and role matching the Auth_User claims, no duplicate Local_User, and the original creation timestamp preserved on repeat sync.
3. WHEN the server starts in Offline_Mode, THE System SHALL complete startup without error.
4. WHILE the server runs in Offline_Mode, THE System SHALL persist a Flag through the in-memory Repository without issuing any request to Supabase or any other external service.
5. THE User_Sync SHALL execute its queries only within the in-memory and Postgres Repository implementations, with no ad-hoc User_Sync query outside those implementations.

### Requirement 8: SQL safety and trust-boundary validation

**User Story:** As a security-conscious maintainer, I want sync to follow the project's data-safety conventions, so that no injection or malformed-input risk is introduced.

#### Acceptance Criteria

1. THE Postgres User_Sync SHALL use parameterized SQL exclusively and SHALL NOT construct SQL by string interpolation.
2. WHEN an Auth_User performs an Identity_Bearing_Action, THE System SHALL validate the Auth_User Subject at the request trust boundary, before invoking User_Sync or persisting any record, requiring the Subject to be a non-empty, UUID-formatted string.
3. IF the Auth_User Subject is absent or is not a non-empty, UUID-formatted string, THEN THE System SHALL reject the Identity_Bearing_Action with a client-error response that carries an error indication that identity validation failed, SHALL NOT invoke User_Sync, and SHALL NOT persist the dependent record.
4. WHEN an Auth_User performs an Identity_Bearing_Action whose claims include an email or a role, THE System SHALL validate those claims at the trust boundary before invoking User_Sync, requiring each present email to be a syntactically valid email address of at most 320 characters and each present role to be a non-empty string of at most 255 characters.
5. IF a present email or role claim fails trust-boundary validation, THEN THE System SHALL reject the Identity_Bearing_Action with a client-error response that carries an error indication that claim validation failed, SHALL NOT invoke User_Sync, and SHALL NOT persist the dependent record.

### Requirement 9: Additive migration

**User Story:** As an operator, I want the schema change to be additive and re-runnable, so that applying it preserves all existing data.

#### Acceptance Criteria

1. THE database migration SHALL only create new schema objects and SHALL NOT drop, rename, alter the type of, or remove a constraint from any existing table or column.
2. THE database migration SHALL be re-runnable, such that WHEN it is applied two or more times consecutively, THE database migration SHALL complete each application without error and SHALL leave the resulting schema identical to a single application.
3. WHEN the migration is applied to a populated database, THE System SHALL preserve every pre-existing row in all existing tables unchanged, deleting or modifying none.
4. THE database migration SHALL sort lexically after every existing migration filename, so that the migration runner applies it after all existing migrations.

### Requirement 10: Invariant gate and compass preserved

**User Story:** As a maintainer, I want this feature to leave the moat intact, so that report readiness and the lens-not-a-judge stance are unchanged.

#### Acceptance Criteria

1. THE feature SHALL leave the Invariant_Gate logic in `core/assemble.ts` byte-for-byte unchanged.
2. THE Local_User record SHALL carry no content-truthfulness-verdict field and no creator-reliability-rating field.
3. WHEN identical report inputs are assembled before and after a User_Sync, THE System SHALL produce the same readiness classification.
4. THE User_Sync SHALL introduce no path that reads, writes, or modifies any input consumed by the Invariant_Gate.
5. THE System SHALL expose no User_Sync-originated surface or response that displays a verdict on content truthfulness or a reliability rating tied to a person or channel.
