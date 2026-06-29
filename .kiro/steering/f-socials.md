# f-Socials — project steering

Always-on context for working in this repo. Keep this lean; it loads on every interaction.

## Compass (non-negotiable)

**f-Socials is a lens, not a judge.** It surfaces framing and evidence to inoculate readers; it never issues verdicts about content and never labels creators.

- Source-reliability tiers attach to **sources and citations only — never to a content creator.**
- No surface may display a verdict on truthfulness or a reliability rating tied to a person/channel.
- When evidence is absent, say so honestly ("no external review found") rather than implying a judgment.

## The invariant gate (do not weaken)

`app/apps/server/src/core/assemble.ts` gates a report to `ready` only if: no claim asserts an evidence strength it cannot cite (a claim with `evidenceStrength: 'none'` and zero citations is a **valid, honest** state), every framing signal has an evidenced example (non-empty quote + explanation), confidence clears the floor, and at least one claim was extracted. Otherwise → `needs_review`.

This gate is the codified moat. **If a feature seems to require weakening it, the feature is wrong.** New work should satisfy the gate by construction and only ever *verify* it (don't edit it). Guarded by `test/invariant.test.ts` plus the gate property tests.

## Project shape

- Monorepo under `app/`. Two packages:
  - `app/apps/server` — Node + Express, `node:test` runner, TypeScript ESM (`"type": "module"`, `moduleResolution: "Bundler"` → **extensionless relative imports**). Build: `tsc --noEmit` type gate then `tsup` to `dist/`. API entrypoint `index.ts`, worker entrypoint `worker.ts`, shared composition root `compose.ts`.
  - `app/apps/web` — React 19 + Vite + Vitest. **Hash routing only** (`#/...`), no router dependency. Icons from `lucide-react` (already installed).
- Dependency injection through `src/infra/ports.ts`; real services (Postgres/Redis/BullMQ/Gemini/Tavily/etc.) sit behind interfaces and are **selected by `.env` flags** in `compose.ts`. New persistence goes through new `Repository` methods, not ad-hoc queries.
- Offline-first: with **zero API keys** the server falls back to mock providers + in-memory infra. Keep that path working.
- Source-tier classification is the pure, offline policy in `core/sourceTier.ts` (open signals only — IFCN / institutional domains + suffix rules / press councils; **no Ad Fontes / AllSides / MBFC**). It is authoritative over provider-guessed tiers.

## Conventions

- Match existing style before introducing anything new; reuse the helpers/patterns already here (ponytail rung-ladder: reuse > stdlib > one line > minimal new code).
- Validate input at the trust boundary with zod (`src/http/validation.ts`).
- Use parameterized SQL, never string interpolation.
- New API routes: public vs `requireAuth` is a deliberate choice — mutating/identity routes are gated, anonymous intake (disputes) is explicit.
- Web: keep color-never-alone (text label beside every color signal), ARIA wiring, keyboard operability, and ≤768px single-column intact.

## Testing

- Property-based testing with **`fast-check`**, minimum **100 runs** per property. Server PBTs run under `node:test` + `node:assert`; web PBTs/units under Vitest + React Testing Library.
- Each property test carries a comment: `// Feature: <feature-name>, Property <n>: <description>` plus a `Validates: Requirements …` reference.
- Non-trivial logic leaves one runnable check behind. Server suite is an explicit file list in `package.json`; add new `test/*.test.ts` files to it (slow spawn/build tests live in a separate `test:build` script). Web suite is `vitest run`.
- Run before claiming done: server `npm test` + `npm run typecheck` (in `apps/server`); web `npx vitest run` + `tsc -b` (in `apps/web`).

## Deploy notes

- API and Worker are **separate long-running processes** in the deployed config; `RUN_WORKER_IN_PROCESS` keeps single-process dev. `NODE_ENV=production` = deployed mode.
- Startup exits naming any missing required config (`DATABASE_URL` when `REPO_DRIVER=postgres`, `REDIS_URL` for Redis drivers, `CORS_ORIGIN`). Access controls (auth, rate limiter) degrade-and-warn (fail closed), they don't block startup.
- CORS is an origin decision (`http/cors.ts` `allowOrigin`): set `CORS_ORIGIN` (server) and `VITE_API_BASE` (web) in prod. Real providers mean the analysis endpoint costs money — confirm auth + rate limits + CORS on the deployed config before public exposure.
- Canonical secrets file: `app/apps/server/.env`. Migrations: `npm run migrate` applies `db/migrations/*.sql` in order.

## Current known limits (intentional)

- Full **WCAG 2.2 AA** conformance still needs manual browser/AT review; automated checks cover ARIA wiring + the CSS-variable contrast audit, not real pixel contrast.
- The web app **now has a client-side auth flow** (sign up / in / out + session, `@supabase/supabase-js` behind an `AuthClient` seam) wired to the real `requireAuth` server, plus save/history (`#/history`) and **institutional workspaces** (`#/workspaces`, `#/workspaces/:id` — shared collections + classroom annotation, membership-scoped); with no Supabase config it degrades gracefully (unavailable message, no form, rest of the app keeps working). See "Accounts save & history" and "Institutional workspace" in the debt ledger.
- Saved reports **and institutional workspaces** key on the **Supabase JWT subject (`TEXT`)**, not the legacy `users(id)` UUID — Supabase users are still not synced into the local `users` table (the `reader_saved_reports` table and the `007` workspace tables deliberately follow the migration-005 subject convention).
- Workspace persistence is additive migration `007_workspaces.sql` (`workspaces`/`workspace_members`/`workspace_invites`/`shared_collections`/`collection_items`/`annotations`), reached only through new `Repository` methods; a single `loadMembership` route guard (404-before-403, owner-only + author-or-owner predicates) is the authorization seam. Invariant gate untouched; no workspace surface or response carries a verdict or creator rating.

## Sources of truth

- Build state / what's wired: `f-Socials-debt-and-todo.md`
- Sequencing & strategy (what's next and why): `f-Socials-roadmap.md`
- Settled direction & execution spec: `f-Socials-refined-concept.md`, `f-Socials-v1-product-definition.md`
