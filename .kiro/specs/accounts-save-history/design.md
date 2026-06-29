# Design Document

## Overview

This feature delivers Slice 2 of the "Pilots" phase: a **client-side accounts experience** for the React web app and the **save/history persistence** behind it. The analysis engine, the invariant gate, and server-side `requireAuth` (Supabase HS256 JWT verification) are already shipped; what is missing is (1) a way for the web app to obtain and carry a Supabase session, and (2) a per-reader saved-report store reachable through `Repository` methods.

The work is deliberately narrow:

- **Web (`app/apps/web`)** — a new `AuthClient` seam (sign up / sign in / sign out / session restore / token refresh), a session-aware API layer that attaches `Authorization: Bearer` to identity/mutating calls, a sign-in/sign-up surface and a `#/history` view, and the wiring that turns the existing always-prompt Flag/Save controls into session-gated controls.
- **Server (`app/apps/server`)** — three new `requireAuth`-gated routes (save, remove, history), their zod validation, and three new `Repository` methods implemented in both the in-memory and Postgres drivers.
- **Schema** — one additive migration `006`, the next after `005`.

Three hard constraints from the steering shape every decision:

1. **Lens, not a judge.** No account/history surface or API response carries a truthfulness verdict or a creator-reliability rating; source tiers attach only to sources/citations (Req 12).
2. **The invariant gate is read-only.** `core/assemble.ts` is byte-for-byte untouched; saved report content is consumed and returned unchanged (Req 13).
3. **Offline-first survives.** With no Supabase configuration the web app degrades gracefully and the rest of the app keeps working; with the in-memory repository and no API keys, save/remove/history complete without error (Req 5, Req 11.7).

### Key design decisions

- **Reader identity is the verified JWT subject (`req.user.id`), stored as `TEXT`.** This follows the convention established by migration `005` (`assigned_reviewer`, `resolved_by` are `TEXT` holding the Supabase subject), not the legacy `users(id)` UUID foreign key from migration `001`. See Data Models for why migration `006` adds a new table rather than reusing the dormant `saved_reports` table.
- **The web Auth_Client wraps `@supabase/supabase-js` behind a small interface.** Session persistence, token auto-refresh, and expiry handling (Req 4.1, 4.5, 4.6) are exactly what the official SDK does well; hand-rolling refresh timers and storage is more code we would own and more bug surface. The SDK sits behind an `AuthClient` interface (mirroring the server's `ports.ts` DI pattern) so the rest of the app never imports it directly, the degraded path can supply a null implementation without constructing the SDK, and Vitest/fast-check can inject a fake. This adds one dependency; the tradeoff is recorded here deliberately.
- **Save/history persistence goes through new `Repository` methods only.** Route handlers contain zero SQL (Req 11.1); the Postgres driver uses parameterized SQL exclusively (Req 11.5); the in-memory driver mirrors its results (Req 11.2).

## Architecture

```mermaid
flowchart TD
  subgraph Web["app/apps/web (React 19, hash routing)"]
    App[App.tsx view router]
    Auth[AuthClient interface]
    SupaImpl[SupabaseAuthClient (@supabase/supabase-js)]
    NullImpl[UnavailableAuthClient (degraded)]
    Session[useSession hook / session state]
    APIc[api/client.ts authedFetch]
    Views[SignIn / SignUp / History views + Save control]
    App --> Session
    Session --> Auth
    Auth -. configured .-> SupaImpl
    Auth -. not configured .-> NullImpl
    Views --> Session
    Views --> APIc
    APIc --> Session
  end

  subgraph Supabase["Supabase Authentication (GoTrue)"]
    GoTrue[(sign up / sign in / refresh / sign out)]
  end

  subgraph Server["app/apps/server (Express)"]
    Routes[routes.ts: /saved-reports +]
    ReqAuth[requireAuth middleware]
    Valid[zod validation.ts]
    Repo[Repository port]
    Mem[InMemoryRepository]
    Pg[PostgresRepository]
    Routes --> ReqAuth --> Valid --> Repo
    Repo -. REPO_DRIVER=memory .-> Mem
    Repo -. REPO_DRIVER=postgres .-> Pg
  end

  SupaImpl <--> GoTrue
  APIc -->|Bearer access_token| Routes
  ReqAuth -->|verify HS256 JWT| Server
  Pg --> DB[(Postgres: reader_saved_reports)]
```

Request flow for a save:

1. Reader activates the Save_Control. If no session and Auth_Configured, the web app routes to sign-in retaining the report context and the pending control (Req 6.2, 6.7). If not Auth_Configured, it shows the unavailable message and sends nothing (Req 5.3).
2. With an active session, `authedFetch` POSTs `/api/v1/analyses/:id/save` (or the chosen route shape) with `Authorization: Bearer <access_token>` (Req 6.4, 7.1).
3. `requireAuth` verifies the token → 401 on failure (Req 7.5, 10.1). zod validates the report id param → 400 on malformed (Req 10.4).
4. The route loads the report → 404 if absent (Req 7.4), then calls `repo.saveSavedReport(readerId, reportId)` — idempotent (Req 7.3).
5. On success the web app shows a "Saved" indicator with a text label beside any color/icon (Req 7.2, 14.3).

The server never has client-side auth; it only verifies tokens. CORS, rate limiting, and `requireAuth` are unchanged and reused.

## Components and Interfaces

### Server

#### Repository port additions (`src/infra/ports.ts`)

Three methods are added to the `Repository` interface. They are the only persistence path for Saved_Reports (Req 11.1), and both drivers must return equivalent results for identical inputs (Req 11.2).

```ts
export interface SavedReportEntry {
  reportId: string;
  savedAt: string; // ISO 8601
}

export interface Repository {
  // ...existing methods unchanged...

  // Idempotent: at most one Saved_Report per (readerId, reportId). A repeat save
  // keeps the single existing row and its original savedAt, and reports success
  // without creating a duplicate (Req 7.3, 11.6). Scoped to readerId.
  saveSavedReport(readerId: string, reportId: string): Promise<void>;

  // Idempotent: removing a report not in the reader's set is a no-op success and
  // leaves every other Saved_Report untouched (Req 8.3, 10.7, 11.10). Scoped to readerId.
  removeSavedReport(readerId: string, reportId: string): Promise<void>;

  // Reverse-chronological (savedAt DESC), deterministic tie-break by reportId DESC
  // so equal-timestamp rows keep a stable order across reloads (Req 9.2). Returns
  // only this reader's entries (Req 9.6, 11.8); [] when none (Req 10.8).
  listSavedReports(readerId: string): Promise<SavedReportEntry[]>;
}
```

`listSavedReports` returns the lens-safe projection only — `reportId` + `savedAt`. It deliberately carries no creator-reliability rating and no truthfulness verdict (Req 12.4, 12.5). The web History_View fetches each entry's full (already lens-safe) report on demand via the existing `GET /analyses/:id` when the reader selects it (Req 9.5), so no report body is duplicated into the history response.

#### In-memory implementation (`src/infra/memory.ts`)

```ts
// Map<readerId, Map<reportId, savedAt>> — at most one entry per (reader, report)
// by construction, mirroring the Postgres PRIMARY KEY (reader_id, report_id).
private savedByReader = new Map<string, Map<string, string>>();
```

- `saveSavedReport`: if the inner map already has `reportId`, leave its `savedAt` unchanged (idempotent); else set `savedAt = new Date().toISOString()`.
- `removeSavedReport`: delete the key if present; absent ⇒ no-op.
- `listSavedReports`: snapshot the reader's entries, sort `savedAt` DESC then `reportId` DESC, return `[]` for an unknown reader.

Each method runs to completion with no `await` between read and write, so on the single-threaded event loop it is atomic by construction (same reasoning as the existing review methods).

#### Postgres implementation (`src/infra/postgres.ts`)

All three use parameterized SQL only (Req 11.5):

```sql
-- saveSavedReport (idempotent upsert; keeps original saved_at on conflict)
INSERT INTO reader_saved_reports (reader_id, report_id)
VALUES ($1, $2)
ON CONFLICT (reader_id, report_id) DO NOTHING;

-- removeSavedReport (idempotent; scoped to reader)
DELETE FROM reader_saved_reports WHERE reader_id = $1 AND report_id = $2;

-- listSavedReports (reader-scoped, deterministic order)
SELECT report_id, saved_at
FROM reader_saved_reports
WHERE reader_id = $1
ORDER BY saved_at DESC, report_id DESC;
```

A backing-store failure propagates as a rejected promise so the route maps it to a 5xx and existing rows are left unchanged (Req 11.9); unlike the best-effort dual-write, these are the authoritative writes for this feature and must not be silently swallowed.

#### Routes (`src/http/routes.ts`)

Three routes, all behind `requireAuth` (Req 10.1, 10.2, 10.3); the reader is always the verified `req.user!.id` (Req 10.5). They reuse the existing `paramId` helper and the report-existence check pattern.

| Method & path | Auth | Validation | Success | Errors |
|---|---|---|---|---|
| `POST /api/v1/analyses/:id/save` | `requireAuth` | `:id` is a uuid (zod) | `200 { ok: true, saved: true }` | 400 malformed id, 404 report missing, 401 no/invalid token |
| `DELETE /api/v1/analyses/:id/save` | `requireAuth` | `:id` is a uuid (zod) | `200 { ok: true, saved: false }` | 400 malformed id, 401 no/invalid token (removal of a non-saved report is success — Req 8.3, 10.7) |
| `GET /api/v1/saved-reports` | `requireAuth` | none | `200 SavedReportEntry[]` (`[]` when empty — Req 10.8) | 401 no/invalid token |

Notes:
- Save returns 404 only when the report does not exist (Req 7.4); the route loads `repo.getReport(id)` first, exactly like the flags route.
- Remove does **not** 404 on an unsaved/unknown report — it is an idempotent success (Req 8.3, 10.7). It still validates the id shape (400 on malformed) before persisting (Req 10.4).
- When the JWT secret is unconfigured, `requireAuth` already yields 401 via `optionalAuth`'s `auth_not_configured` path, satisfying Req 10.6 with no new code.
- Telemetry `emit('save'|'unsave', { reportId })` carries the report id only — never the reader id (matches the existing flag event convention, Req 12 neutrality).

#### Validation (`src/http/validation.ts`)

The save/remove routes validate the `:id` path parameter as a UUID. Reuse a small `z.string().uuid()` check rather than a new schema object since there is no request body:

```ts
export const reportIdParam = z.string().uuid();
```

History takes no input. Malformed ids are rejected with 400 before any persistence side effect (Req 10.4).

### Web

#### `AuthClient` seam (`src/auth/authClient.ts`)

```ts
export interface Session {
  accessToken: string;
  reader: { id: string; email?: string };
}

export interface AuthClient {
  readonly configured: boolean;
  getSession(): Promise<Session | null>;          // restore on load (Req 4.1)
  signUp(email: string, password: string): Promise<Session>;   // Req 1
  signIn(email: string, password: string): Promise<Session>;   // Req 2
  signOut(): Promise<void>;                        // Req 3
  onChange(cb: (s: Session | null) => void): () => void; // refresh/expiry (Req 4.4–4.7)
}
```

- `SupabaseAuthClient` wraps `createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })`. `signUp`/`signIn` map to `auth.signUp` / `auth.signInWithPassword`; `signOut` to `auth.signOut`; `getSession`/`onChange` to `auth.getSession` / `auth.onAuthStateChange`. The 30-second timeouts (Req 1.8, 2.7) are enforced by racing each SDK call against an `AbortController`/timeout and surfacing a timeout error.
- `makeAuthClient(env)` returns `UnavailableAuthClient` (`configured = false`, all calls reject with an `auth_unavailable` error) when the Supabase URL or anon key is absent or malformed (Req 5.5). It never constructs the SDK in that case, so initialization cannot throw (Req 5.4).
- `isAuthConfigured(env)` is a pure predicate over `{ VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY }`: both present, URL parseable as `https?:` (Req 5.5). It is unit/property tested.

#### Session state (`src/auth/useSession.ts`)

A small hook owns the live `Session | null`, subscribes to `authClient.onChange`, and exposes `signIn/signUp/signOut`. On a 401 from any authed request it clears the session and the app falls back to the Anonymous experience (Req 4.4). A pending-gated-action ref records `{ reportId, control }` so a sign-in triggered by Flag/Save returns the reader to the report and re-enables the control (Req 6.2, 6.7).

#### API layer (`src/api/client.ts`)

A new `authedFetch(path, init, accessToken?)` attaches `Authorization: Bearer <accessToken>` when a session is active and omits it otherwise (Req 4.2, 4.3). It maps `401 → AuthExpiredError` so callers can trigger session teardown (Req 4.4). New functions:

```ts
saveReport(reportId, token): Promise<void>     // POST .../save  (Req 7)
unsaveReport(reportId, token): Promise<void>   // DELETE .../save (Req 8)
listSavedReports(token): Promise<SavedReportEntry[]>  // GET /saved-reports (Req 9)
```

The existing `submitFlag` is extended to take a token; `submitAnalysis`/`getReport` stay anonymous-capable.

#### Views (`src/components/`)

- `AuthPanel.tsx` — sign-up and sign-in forms with client-side validation (Req 1.5–1.7, 2.6), in-flight disabling (Req 1.4, 2.4), error/timeout messaging via an ARIA live region (Req 14.9), keyboard operability and visible focus (Req 14.2, 14.8). When not Auth_Configured it renders the unavailable message and **no form** (Req 5.1).
- `HistoryView.tsx` (`#/history`) — lists `SavedReportEntry[]` newest-first, empty-state when zero (Req 9.3, 9.4), per-row remove control with optimistic exclusion on success / retain-and-error on failure (Req 8.2, 8.5), select-to-open (Req 9.5), retry on load failure/timeout (Req 9.9). Renders no verdict and no creator rating (Req 12.1, 12.2); accent uses muted teal `#0d9488` and icons come from `lucide-react` (Req 14.6, 14.7); single column ≤768px (Req 14.5).
- `App.tsx` — adds `#/sign-in` and `#/history` to the existing hash router (Req 14.1), a header sign-in/sign-out affordance, and the gated-action redirect. The Save control on `Report.tsx` switches from an unconditional sign-in prompt to: enabled when session active (Req 6.1); sign-in redirect when anonymous + configured (Req 6.2); unavailable message when not configured (Req 5.3).

## Data Models

### Migration `006_saved_reports.sql`

`saved_at` ordering and at-most-one-per-(reader,report) are the only schema needs. Migration `006` is **additive only** (Req 11.3): it creates one new table and one index, preserves every pre-existing row, and changes no existing route's request/response shape. It applies in lexical order after `005_review_workflow.sql` (Req 11.4).

```sql
-- f-Socials accounts-save-history — migration 006.
-- Additive: a per-reader saved-report store keyed by the Supabase JWT subject
-- (TEXT), following the identity convention established in migration 005
-- (assigned_reviewer / resolved_by are TEXT subjects, not users(id) FKs).
-- Re-run safe: IF NOT EXISTS on the table and index.
-- Lens, not a judge: no column expresses a creator rating or truthfulness verdict.
CREATE TABLE IF NOT EXISTS reader_saved_reports (
  reader_id  TEXT        NOT NULL,                  -- Supabase auth subject (JWT sub)
  report_id  UUID        NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_id, report_id)                -- enforces at-most-one (Req 7.3, 11.6)
);

-- Reader-scoped, reverse-chronological listing with the deterministic tie-break (Req 9.2).
CREATE INDEX IF NOT EXISTS idx_reader_saved_reports_listing
  ON reader_saved_reports (reader_id, saved_at DESC, report_id DESC);
```

**Why a new table rather than the existing `saved_reports`.** Migration `001` already defines `saved_reports (user_id UUID REFERENCES users(id), report_id, saved_at, PRIMARY KEY (user_id, report_id))`. That table keys on the **local `users` table** UUID; the authenticated reader identity in this codebase is the **Supabase JWT subject**, which is not provisioned into `users`. Reusing the legacy table would require either seeding a `users` row per Supabase subject (out of scope, and new auth-coupling code) or altering its foreign key (not additive — violates Req 11.3). The legacy `saved_reports` table has never been written to (no `Repository` method inserts into it), so it is dormant. Migration `006` therefore adds `reader_saved_reports`, which follows the proven, additive `005` `TEXT`-subject pattern and keeps the offline-first/Postgres parity clean. The legacy table is left untouched.

The `ON DELETE CASCADE` on `report_id` keeps the store consistent if a report is ever deleted, and never affects report content (Req 13.3): removing a *saved* row deletes only the association, never the `analysis_reports` row.

### Shared types

- Server `SavedReportEntry { reportId: string; savedAt: string }` lives beside the `Repository` port.
- Web `src/api/types.ts` gains the mirrored `SavedReportEntry`. No change to `AnalysisReport`, `Provenance`, or any tier type — the History_View consumes the existing lens-safe report shape unchanged (Req 13.3).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The acceptance criteria split into two groups. The **persistence and pure-logic** group (repository save/remove/list, response neutrality, credential validation, config detection, token attachment) carries universal properties and is covered below with property-based tests. The **UI interaction, error-path, timeout, accessibility, and infrastructure** group (most of Req 1–6 transitions, Req 14 a11y, migration application, static architectural rules) is covered by example/integration/smoke tests in the Testing Strategy — these do not vary meaningfully with input and are not property-tested.

### Property 1: Save is idempotent and visible in history

*For any* reader and report identifier, and *for any* number of repeated saves (interleaved with saves by other readers), the repository holds **exactly one** Saved_Report for that (reader, report) pair, and that report appears in the reader's history.

**Validates: Requirements 7.3, 9.8, 11.6, 11.7**

### Property 2: Remove is idempotent and non-interfering

*For any* reader's saved set and *for any* report identifier, removing that report leaves the pair absent and every other Saved_Report — the reader's own and every other reader's — unchanged; removing a report that is not in the set succeeds and changes nothing.

**Validates: Requirements 8.3, 10.7, 11.10**

### Property 3: History is reader-scoped

*For any* state produced by saves across multiple readers, listing a reader's history returns exactly that reader's current saves and excludes every other reader's report; a reader with no saves gets an empty list.

**Validates: Requirements 9.6, 10.5, 10.8, 11.8**

### Property 4: History ordering is deterministic and stable

*For any* set of saved entries, the history list is ordered most-recently-saved first, breaking ties by report identifier (descending), and repeated calls on the same state return an identical order.

**Validates: Requirements 9.2**

### Property 5: In-memory and Postgres repositories agree

*For any* sequence of save/remove/list operations, the in-memory and Postgres repositories return equivalent results (same membership and same order) for identical inputs.

**Validates: Requirements 11.2**

### Property 6: Saved report content is immutable across save/history operations

*For any* persisted report, saving it, removing it from a reader's set, or listing it in history leaves the report's stored content — claims, citations, framing signals, and readiness state — byte-for-byte unchanged from its value before the operation.

**Validates: Requirements 13.3**

### Property 7: Account-surface responses are lens-not-judge

*For any* saved state, the save and history API responses contain only neutral association fields (report identifier, saved timestamp, success flag) and no field representing a content-truthfulness verdict or a creator-reliability rating, and no source-reliability tier attached to a creator/author/person/channel.

**Validates: Requirements 12.4, 12.5, 12.6**

### Property 8: Credential validation accepts exactly the well-formed inputs

*For any* email/password pair, the client-side validator accepts the submission if and only if the email is non-empty, at most 254 characters, and syntactically valid (local-part, "@", domain with a TLD) and the password is 8–72 characters; rejected inputs produce a validation message and send no request.

**Validates: Requirements 1.5, 1.6, 1.7, 2.6**

### Property 9: Auth configuration detection is total

*For any* web Supabase configuration object, the app is treated as Auth_Configured if and only if both the Supabase URL and anonymous key are present and the URL is a syntactically valid `http(s)` URL; any absent or malformed value yields not-configured (and thus the degraded behavior).

**Validates: Requirements 5.5**

### Property 10: Token attachment follows session state

*For any* request to an identity or mutating API route, an `Authorization: Bearer` header carrying the access token is attached if and only if a session is active; with no active session the request carries no `Authorization` header.

**Validates: Requirements 3.4, 4.2, 4.3**

## Error Handling

| Condition | Layer | Behavior | Requirement |
|---|---|---|---|
| Sign-up/sign-in rejected by Supabase | web | Show rejection/auth-failed message; stay anonymous; re-enable control; sign-in retains email | 1.3, 2.3 |
| No auth response within 30s | web | Abort the call, show timeout/unavailable message, re-enable, stay anonymous | 1.8, 2.7 |
| Sign-out request fails | web | Discard token locally, present anonymous experience, warn remote session may persist | 3.5 |
| Authed request returns 401 | web | Clear session, discard stored session, present anonymous experience | 4.4 |
| Token expired, refresh fails / no refresh token | web | End session, discard, anonymous | 4.6, 4.7 |
| Not Auth_Configured | web | Unavailable message, no sign-in form; Save activation sends nothing, view unchanged; other views keep working; boot raises no unhandled error | 5.1–5.5 |
| Flag/Save fails (not 401) | web | Error message "action not recorded", re-enable control | 6.6 |
| Save fails (not 404/401) or >10s | web | "Save did not complete" text, no saved indicator, re-enable for retry | 7.7 |
| Remove returns non-success | web | Retain report in History_View, show error indication | 8.5 |
| History fails or >10s | web | Error message, no empty-state, offer retry | 9.9 |
| Missing/invalid token at route | server | 401 via `requireAuth`; no read/modify/create | 7.5, 8.4, 9.7, 10.1–10.3, 10.6 |
| Malformed report id | server | 400 via zod before any persistence side effect | 10.4 |
| Save targets nonexistent report | server | 404; no Saved_Report created | 7.4 |
| Backing-store failure | repository | Reject the promise (route → 5xx); existing Saved_Reports unchanged; no partial mutation | 11.9 |

The save/remove/history repository writes reject on failure (not best-effort swallowed) because they are the authoritative writes for this feature; the route maps a rejection to a 5xx and the web layer's generic failure path (7.7 / 8.5 / 9.9) handles it.

## Testing Strategy

Dual approach: **property tests** verify the universal properties above across generated inputs; **example/integration/smoke tests** verify specific UI transitions, error paths, auth wiring, the migration, and the static architectural rules.

### Property-based tests

- Library: **`fast-check`**, minimum **100 runs** per property (server PBTs under `node:test` + `node:assert`; web PBTs under Vitest).
- Each property test carries the comment `// Feature: accounts-save-history, Property <n>: <description>` plus a `Validates: Requirements …` reference.
- Each correctness property is implemented by a **single** property-based test.
- Mapping:
  - Properties 1–4, 6 → server, against `InMemoryRepository` with generated readers/reports/op-sequences (`test/savedReports.*.test.ts`, registered in `package.json` `test`).
  - Property 5 (parity) → an integration test running the same generated op-sequence against `InMemoryRepository` and `PostgresRepository`; registered under `test:integration` (needs a live DB), with the in-memory result as the model.
  - Property 7 (neutrality) → server property over generated saved states asserting the response objects' key set; a companion static test greps the route/response code for forbidden field names.
  - Properties 8–10 → web, pure functions (`isAuthConfigured`, the credential validator, `authedFetch` header construction) under Vitest + fast-check.

### Example-based unit / component tests (web, Vitest + React Testing Library + vitest-axe)

- Sign-up/sign-in/sign-out success, rejection, in-flight disable, timeout, and re-enable transitions with an injected fake `AuthClient` and fake timers (Req 1.1–1.4, 1.8, 2.1–2.5, 2.7, 3.1–3.3, 3.5, 4.1, 4.4–4.7).
- Gated Flag/Save: enabled with session, sign-in redirect when anonymous+configured with retained intent and post-sign-in return, unavailable message when not configured, pending-state debounce (Req 6.1–6.7, 7.1–7.2, 7.6).
- History_View: empty-state, populated, remove success/failure, select-to-open, load error/retry, color-never-alone saved/remove labels (Req 8.1–8.2, 8.5, 9.1, 9.3–9.5, 9.9).
- Accessibility: keyboard reachability/activation, accessible name+role (axe), visible focus, ≤768px single column, ARIA live status region (Req 14.2–14.5, 14.8, 14.9).

### Integration tests (server)

- Route auth gating: 401 without token, 400 on malformed id, 404 on save to missing report, success scoping to the verified reader (Req 7.4, 7.5, 8.4, 9.7, 10.1–10.6).
- Migration `006`: apply to a populated database, assert all pre-existing rows preserved, new table present, existing route response shapes unchanged, lexical apply order after `005` (Req 11.3, 11.4); registered under `test:integration`.

### Smoke / static tests

- `assemble.ts` byte-for-byte unchanged (file hash) and no pipeline stage altered (Req 13.1, 13.2, 13.4).
- Route handlers contain no direct DB queries; Postgres methods use parameterized SQL only (grep) (Req 11.1, 11.5).
- No third-party router dependency in `apps/web/package.json`; account/history routes are hash-based (Req 14.1).
- Accent color `#0d9488` and `lucide-react` icon sourcing on the new surfaces (Req 14.6, 14.7).
- Offline-first wiring: with the in-memory repository and no API keys, save/remove/history complete and return the resulting set (Req 11.7).

### Commands (run before claiming done)

- Server: `npm test` + `npm run typecheck` in `apps/server`; integration suite via `npm run test:integration` when a database is available.
- Web: `npx vitest run` + `tsc -b` in `apps/web`.
