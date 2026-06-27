# f-Socials — code

**A media-literacy lens, not a judge.** Submit an input (YouTube link · article URL · pasted transcript) → cache check → queued job → worker runs the analysis pipeline (transcript → extract claims & framing → evidence → bridging perspectives → invariant gate) → stored, shareable report.

> Status: the **Foundation engine is built and proven end-to-end** with real providers and durable infra, and the **trust-and-launch bundle is shipped** — a transparent source-tier policy, a public Methodology page, dispute/flag intake, an accessibility pass, and a real production build with a split worker process and origin-checked CORS. It still runs **fully offline with zero API keys** (mock providers + in-memory infra) for dev. For the current build state see `../f-Socials-debt-and-todo.md`; for what's next see `../f-Socials-roadmap.md`.

## What's wired (not mocks)

| Stage | Real implementation |
|---|---|
| Transcript | paste ✓ · YouTube via Supadata ✓ · article via Firecrawl ✓ |
| LLM extraction | Gemini (+ model fallback) ✓ |
| Evidence | chain: Google Fact Check → GDELT → Tavily ✓ |
| Perspectives | bridging: Tavily + Gemini ✓ |
| Cache / Queue | Upstash Redis (ioredis + BullMQ) ✓ |
| Repository | Neon Postgres (`pg`) ✓ — durable across restart |
| Auth | Supabase JWT verify (`jose`): `optionalAuth` on `/api/v1`, `requireAuth` on protected routes ✓ |
| Rate limiting | per-user/per-IP/day, Redis-backed, counts only cache misses ✓ |
| Source-tier policy | transparent, versioned classifier from open signals (IFCN · institutional domain registry + suffix rules · press councils) ✓ — authoritative over provider guesses; served at `GET /api/v1/policy` |
| Dispute / flag intake | anonymous `POST /analyses/:id/disputes` · authenticated `POST /analyses/:id/flags` (technique must match the report) ✓ |
| CORS | origin-checked predicate (`allowOrigin`): matches `CORS_ORIGIN` → allow, present-but-mismatched → 403, same-origin → allow ✓ |
| Build / deploy | `tsc --noEmit` type gate + `tsup` emit to runnable `dist/*.js`; API (`index.ts`) and Worker (`worker.ts`) run as separate long-running processes; startup config validation ✓ |
| Frontend | live React 19 app (`apps/web`): submit → loading → report + public share route + Methodology page + dispute modal, accessibility pass (color-never-alone, ARIA, keyboard/focus, ≤768px single-column) ✓ |

Each real service sits behind an interface and is selected by an `.env` flag — flip back to mocks anytime. See `../f-Socials-resources-shopping-list.md` for keys and the full swap table.

## Run it

```bash
cd app
npm install
npm test          # backend test suite (incl. the invariant gate + property tests) — must stay green
npm run typecheck # server + web
npm run dev       # API on http://localhost:4000 (offline-capable with mocks)
npm run dev:web   # React app on the Vite dev server (proxies to the API)
```

The web app has its own Vitest suite (`npm test` inside `apps/web`). For the deployed configuration the server now has a real build and a split worker process:

```bash
cd apps/server
npm run build         # tsc --noEmit type gate, then tsup → dist/index.js + dist/worker.js
npm start             # node dist/index.js   (API only)
npm run start:worker  # node dist/worker.js  (long-running pipeline worker)
```

In dev the worker still runs in-process (`RUN_WORKER_IN_PROCESS`, default on); in the deployed config (`NODE_ENV=production`) the API and worker are separate processes. Startup validation exits with the missing config name if a required deployed value (e.g. `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`) is absent; absent access controls (auth/rate limiter) log a warning and fail closed rather than blocking startup.

With real providers/infra, set the keys in `apps/server/.env` (see `.env.example`) and run `npm run migrate` once to apply `db/migrations/*.sql` to Postgres (now includes `002` adding the nullable `disputes.claim_id`). With no keys set, the server falls back to mocks + in-memory infra automatically.

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
      config.ts             env-driven config + provider/infra selectors
      env.ts
      auth/supabase.ts      Supabase JWT verification (jose)
      core/
        hash.ts             normalize + sha256 cache key
        assemble.ts         THE invariant gate (lens-not-judge)
        sourceTier.ts       transparent source-tier policy (pure, offline) + policyDescriptor
        data/sourceSignals.ts  open-signal seed data (IFCN · institutional domains · press councils)
      pipeline/
        stages.ts           transcript -> extract -> evidence -> perspectives -> gate (applies the tier policy)
        worker.ts           job consumer; persists + caches
      providers/
        types.ts            Transcript / LLM / Evidence / Perspective interfaces
        mock.ts             offline stand-ins (default with no keys)
        gemini.ts           LLM extraction
        transcriptRouter.ts paste / youtube / supadata / firecrawl routing
        supadata.ts youtube.ts firecrawl.ts
        googleFactCheck.ts gdelt.ts tavily.ts chain.ts   evidence chain
        perspective.ts      bridging perspectives (Tavily + Gemini)
      infra/
        ports.ts            Cache / Queue / Repository / RateLimiter interfaces (Repository now has createDispute/createFlag)
        memory.ts           in-memory impls (dev default)
        redis.ts            Upstash Redis cache + BullMQ queue + rate limiter
        postgres.ts         Neon Postgres repository
      http/
        validation.ts       zod input validation at the trust boundary (submit · dispute · flag)
        auth.ts             optionalAuth / requireAuth middleware
        cors.ts             allowOrigin predicate + origin-checked CORS middleware
        routes.ts           analyses · /status · /r/:slug · /policy · /disputes · /flags
      compose.ts            shared composition root (buildContext): infra + providers + meta
      config.ts             env-driven config + missingRequiredConfig startup validation
      index.ts              API entrypoint (HTTP only in the deployed config)
      worker.ts             worker entrypoint (queue.process only)
    test/                   invariant · evidence · youtube · perspective · ratelimit · auth
                            · sourceTier · sourceSignals · gate.* · cors · config · dispute/flag routes
                            · protectedRoutes · servedTiers · build smoke · degraded controls
  apps/web/                 React 19 + Vite app (submit · loading · report · share · methodology · dispute)
    src/
      api/                  client + types (getPolicy · submitDispute · submitFlag)
      components/
        Report.tsx          report UI (claims, framing, context, perspectives, footer actions)
        Methodology.tsx     plain-language transparency page (#/methodology, no auth)
        DisputeModal.tsx    focus-trapped dispute form
      App.tsx main.tsx styles.css
      test/setup.ts         Vitest + Testing Library setup
  db/migrations/            001_init.sql (schema) · 002_dispute_claim_id.sql
  scripts/                  migrate.mjs · probe.mjs (manual e2e checker)
```

## The invariant (non-negotiable)

A report reaches `ready` only if: no claim asserts an evidence strength it can't cite (a claim with `evidenceStrength: 'none'` and zero citations is a **valid, honest** state — "no external review found" — shown plainly), every framing signal carries an evidenced example (quote + explanation), confidence clears the floor, and at least one claim was extracted. Otherwise → `needs_review`. Enforced in `core/assemble.ts`, guarded by `test/invariant.test.ts`. If this gate ever has to be weakened to ship a feature, the feature is wrong.

## What's next

The trust-and-launch bundle is done — methodology page, source-tier policy, dispute/flag intake, accessibility pass, and a safe production build are shipped. Next: accounts/save/history, expert review *queue UI* (intake already exists), persisting Supabase users, the auth UI, and the institutional workspace. Full sequence and rationale in `../f-Socials-roadmap.md`.

> Two known limits, both intentional for this slice: full **WCAG 2.2 AA** conformance still needs manual browser + assistive-technology review (the automated checks cover ARIA wiring and the CSS-variable contrast audit, not real pixel contrast); and the web app has **no client-side auth flow yet**, so the Flag/Save controls always show the sign-in prompt while the server still enforces `requireAuth`.

> ⚠️ Real providers mean the analysis endpoint triggers paid LLM/transcription/search calls. Auth, rate limiting, and origin-checked CORS are wired and tested — confirm `requireAuth`, rate limits, and `CORS_ORIGIN` are set on the deployed config before any public exposure.
