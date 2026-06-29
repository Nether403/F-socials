# f-Socials — code

**A media-literacy lens, not a judge.** Submit an input (YouTube link · article URL · pasted transcript) → cache check → queued job → worker runs the analysis pipeline (transcript → extract claims & framing → evidence → bridging perspectives → invariant gate) → stored, shareable report.

f-Socials shows *how a piece of content is built* — its claims, the evidence behind them, the framing techniques it uses, and other credible angles on the same topic — so a reader can decide what to think. It never declares content "true" or "false" and never rates a creator.

> **Status:** the engine is built and proven end-to-end with real providers and durable infra, and five feature bundles have shipped on top of it: the **trust-and-launch bundle** (transparent source-tier policy, Methodology page, dispute/flag intake, accessibility pass, production build + split worker), the **claim-verification-router** (precision evidence pipeline), **report-graph-normalization** (cross-report analytics dual-write), **parallel-evidence-lookups** (bounded-concurrency evidence retrieval), **observability-instrumentation** (fail-open Sentry + PostHog + the two trust KPIs), and **expert-review-queue** (the role-gated review workflow). It still runs **fully offline with zero API keys** (mock providers + in-memory infra) for dev.
>
> **End users:** see the [user docs](./docs/README.md) — a plain-language manual, FAQ, educator quickstart, and reviewer guide.
> **Build state / what's wired:** `f-Socials-debt-and-todo.md`. **What's next & why:** `f-Socials-roadmap.md`.

## What's wired (not mocks)

| Stage | Real implementation |
|---|---|
| Transcript | paste ✓ · YouTube via Supadata ✓ · article via Firecrawl ✓ |
| LLM extraction | Gemini (+ model fallback) ✓ |
| Evidence | **claim-verification-router**: normalize → triage → query-pack → retrieve → validate → outcome, wrapped around the provider chain (Google Fact Check → GDELT → Tavily). Cites only evidence that matches the *original* claim; honest "no sufficient evidence found" otherwise. The claim loop + per-claim query-variant loop run in **bounded parallel** under one shared per-report semaphore (`CONCURRENCY_CAP`, default 4) ✓ |
| Perspectives | bridging: Tavily + Gemini (social domains filtered out) ✓ |
| Cache / Queue | Upstash Redis (ioredis + BullMQ) ✓ |
| Repository | Neon Postgres (`pg`) ✓ — durable across restart. Reports persist as lossless JSONB **and** dual-write into normalized `claims`/`citations`/`perspective_links` rows for cross-report analytics |
| Auth | Supabase JWT verify (`jose`): `optionalAuth` on `/api/v1`, `requireAuth` on protected routes, `reviewerGuard` (role-gated, fail-closed) on review routes ✓ |
| Rate limiting | per-user/per-IP/day, Redis-backed, counts only cache misses ✓ |
| Source-tier policy | transparent, versioned classifier from open signals (IFCN · institutional domain registry + suffix rules · press councils) ✓ — authoritative over provider guesses; served at `GET /api/v1/policy` |
| Dispute / flag intake | anonymous `POST /analyses/:id/disputes` · authenticated `POST /analyses/:id/flags` (technique must match the report) ✓ |
| Expert review workflow | role-gated `/api/v1/review/*` (queue · claim · release · resolution) over the disputes/flags; bounded, neutrality-safe resolution outcomes feed the report's **derived-on-read** `reviewStatus` (report never rewritten, invariant gate untouched) ✓ |
| Observability | fail-open `Telemetry` port (Sentry + PostHog), zero keys ⇒ no-op; PII `Redactor` + `Neutrality_Guard` at the emission boundary; the two trust KPIs (Citation_Coverage, Model_Human_Agreement) derivable ✓ |
| CORS | origin-checked predicate (`allowOrigin`): matches `CORS_ORIGIN` → allow, present-but-mismatched → 403, same-origin → allow ✓ |
| Build / deploy | `tsc --noEmit` type gate + `tsup` emit to runnable `dist/*.js`; API (`index.ts`) and Worker (`worker.ts`) run as separate long-running processes; startup config validation ✓ |
| Frontend | live React 19 app (`apps/web`): submit → loading → report + public share route + Methodology page + dispute modal + **Reviewer Console** (`#/review`), accessibility pass (color-never-alone, ARIA, keyboard/focus, ≤768px single-column) ✓ |

Each real service sits behind an interface and is selected by an `.env` flag — flip back to mocks anytime. See `f-Socials-resources-shopping-list.md` for keys and the full swap table.

## Run it

```bash
cd app
npm install
npm test          # backend test suite (incl. the invariant gate + property tests) — must stay green
npm run typecheck # server + web
npm run dev       # API on http://localhost:4000 (offline-capable with mocks)
npm run dev:web   # React app on the Vite dev server (proxies to the API)
```

The web app has its own Vitest suite (`npm test` inside `apps/web`). For the deployed configuration the server has a real build and a split worker process:

```bash
cd apps/server
npm run build         # tsc --noEmit type gate, then tsup → dist/index.js + dist/worker.js
npm start             # node dist/index.js   (API only)
npm run start:worker  # node dist/worker.js  (long-running pipeline worker)
```

In dev the worker runs in-process (`RUN_WORKER_IN_PROCESS`, default on); in the deployed config (`NODE_ENV=production`) the API and worker are separate processes. Startup validation exits with the missing config name if a required deployed value (e.g. `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`) is absent; absent access controls (auth / rate limiter / `REVIEWER_ROLE`) log a warning and **fail closed** rather than blocking startup.

With real providers/infra, set the keys in `apps/server/.env` (see `.env.example`) and run `npm run migrate` once to apply `db/migrations/*.sql` to Postgres (`001_init` → `002_dispute_claim_id` → `003_audit_records` → `004_report_graph` → `005_review_workflow`). With no keys set, the server falls back to mocks + in-memory infra automatically.

## Try the flow (dev server running)

```bash
# submit a transcript (works with no API keys)
curl -X POST http://localhost:4000/api/v1/analyses ^
  -H "Content-Type: application/json" ^
  -d "{\"sourceType\":\"transcript\",\"transcript\":\"A study found that 80 percent of people agree. This is shocking and everyone should be outraged!\"}"

# -> { "reportId": "...", "status": "queued", "cached": false }

# fetch the report (processing is near-instant with mocks)
curl http://localhost:4000/api/v1/analyses/<reportId>
```

Submit the same input again and you'll get `"cached": true` — the URL-hash cache in action. Or just use the web app and paste a YouTube link, article URL, or transcript.

## Structure

```
app/
  apps/server/
    src/
      types.ts              domain types (mirror the SQL enums)
      config.ts             env-driven config + provider/infra selectors + startup validation
      concurrency.ts        FIFO counting semaphore (bounded-parallel scheduler)
      env.ts
      auth/supabase.ts      Supabase JWT verification (jose)
      core/
        hash.ts             normalize + sha256 cache key
        assemble.ts         THE invariant gate (lens-not-judge)
        sourceTier.ts       transparent source-tier policy (pure, offline) + policyDescriptor
        reportGraph.ts      pure projection: report -> normalized claim/citation/perspective rows
        reportReviewStatus.ts  pure derived-on-read report review status
        reviewOutcome.ts    bounded, framing/evidence-only resolution-outcome vocabulary
        kpi.ts              the two trust KPIs (citationCoverage, modelHumanAgreement)
        data/sourceSignals.ts  open-signal seed data (IFCN · institutional domains · press councils)
      router/               claim-verification-router (normalize · queryPack · retrieve · validate · outcome · audit)
        benchmark/          offline False-Evidence-Rate + p95 latency Ship_Gate
      pipeline/
        stages.ts           transcript -> extract -> evidence (router, bounded-parallel) -> perspectives -> gate
        worker.ts           job consumer; persists + caches
      providers/            transcript / LLM / evidence-chain / perspective providers (+ offline mocks)
      infra/
        ports.ts            Cache / Queue / Repository / RateLimiter / Telemetry interfaces
        memory.ts           in-memory impls (dev default)
        redis.ts            Upstash Redis cache + BullMQ queue + rate limiter
        postgres.ts         Neon Postgres repository
        telemetry/          Telemetry port impls (noop · active Sentry+PostHog · redact · neutrality)
      http/
        validation.ts       zod input validation at the trust boundary (submit · dispute · flag · review)
        auth.ts             optionalAuth / requireAuth / reviewerGuard middleware
        cors.ts             allowOrigin predicate + origin-checked CORS middleware
        routes.ts           analyses · /status · /r/:slug · /policy · /disputes · /flags · /review/* · /analyses/:id/save · /saved-reports
      scripts/backfill.ts   one-shot report-graph backfill for pre-normalization reports
      compose.ts            shared composition root (buildContext): infra + providers + telemetry + meta
      index.ts              API entrypoint (HTTP only in the deployed config)
      worker.ts             worker entrypoint (queue.process only)
    test/                   invariant · evidence · gate.* · auth · cors · config · router/** ·
                            reportGraph.* · review.* · savedReports.* · telemetry.* · kpi.* · build smoke · degraded controls
  apps/web/                 React 19 + Vite app (submit · loading · report · share · methodology · dispute · review · sign-in · history)
    src/
      api/                  client + types (getPolicy · submitDispute · submitFlag · review fns · authedFetch · save/unsave/listSaved)
      auth/                 authClient (Supabase seam) · useSession hook
      components/
        Report.tsx          report UI (claims, framing, context, perspectives, provenance footer; session-gated Flag/Save)
        Methodology.tsx     plain-language transparency page (#/methodology, no auth)
        DisputeModal.tsx    focus-trapped dispute form
        ReviewerConsole.tsx role-gated review queue UI (#/review)
        AuthPanel.tsx       sign-up / sign-in surface (#/sign-in)
        HistoryView.tsx     saved-report history (#/history)
      App.tsx main.tsx styles.css
  db/migrations/            001_init · 002_dispute_claim_id · 003_audit_records · 004_report_graph · 005_review_workflow · 006_saved_reports
  scripts/                  migrate.mjs · probe.mjs (manual e2e checker)
```

## The invariant (non-negotiable)

A report reaches `ready` only if: no claim asserts an evidence strength it can't cite (a claim with `evidenceStrength: 'none'` and zero citations is a **valid, honest** state — "no external review found" — shown plainly), every framing signal carries an evidenced example (quote + explanation), confidence clears the floor, and at least one claim was extracted. Otherwise → `needs_review`. Enforced in `core/assemble.ts`, guarded by `test/invariant.test.ts` and re-verified at worker boot by `assertInvariantGateIntact()`. **If this gate ever has to be weakened to ship a feature, the feature is wrong.** Every feature since has satisfied it *by construction* and only verified it — the expert-review-queue, for example, never writes the report at all (review status is derived on read).

## What's next

The trust bundle, the precision evidence router, the normalized report graph, bounded-parallel evidence lookups, observability, the expert review workflow, and accounts/save/history are all shipped. Next: persisting Supabase users into the `users` table, EN/NL localization, and the institutional workspace. Full sequence and rationale in `f-Socials-roadmap.md`.

> Two known limits, both intentional for this slice: full **WCAG 2.2 AA** conformance still needs manual browser + assistive-technology review (the automated checks cover ARIA wiring and the CSS-variable contrast audit, not real pixel contrast); and Supabase users are not yet synced into the local `users` table — saved reports deliberately key on the Supabase JWT subject (`TEXT`), but disputes/flags/seats still want a synced user record. The web client-side auth flow (sign up / in / out + session) and save/history are now wired against the `requireAuth` server, degrading gracefully when no Supabase config is present.

> ⚠️ Real providers mean the analysis endpoint triggers paid LLM/transcription/search calls. Auth, rate limiting, role-gated review, and origin-checked CORS are wired and tested — confirm `requireAuth`, rate limits, `REVIEWER_ROLE`, and `CORS_ORIGIN` are set on the deployed config before any public exposure.
