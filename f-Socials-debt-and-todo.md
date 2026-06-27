# f-Socials — Technical Debt & To-Do Ledger

A running overview of shortcuts taken, things deferred, and what's not built yet.
Updated as we go. Priorities: **P0** = before public/real use · **P1** = soon, for a real product · **P2** = nice-to-have / later.

> Legend: `[ ]` open · `[~]` partially done · `[x]` done. Each item tags where it came from.

---

## Current pipeline state (snapshot)

| Stage | Status |
|---|---|
| Transcript | **real** — paste ✓ · YouTube via Supadata ✓ · article via Firecrawl ✓ |
| LLM extraction | **real** — Gemini 3.1-flash-lite + model fallback ✓ |
| Evidence | **real** — chain: Google Fact Check → Tavily ✓ (GDELT planned) |
| Perspectives | **real** — bridging: Tavily + Gemini ✓ |
| Infra (cache/queue/repo) | **real** — Neon Postgres + Upstash (cache + BullMQ), verified durable across restart |
| Auth / rate limiting | **both ✓** — Supabase JWT verify (optional auth + `requireAuth`), per-user/per-IP rate limiting |
| Frontend | **report page live** (`apps/web`) — submit · loading · report, wired to live API via dev proxy |

Verified end-to-end with all real analysis providers + a clickable React UI. 21 backend tests green.

---

## Frontend (apps/web)

- [x] **Scaffold + report page.** Vite + React 19 + TS, design tokens, Lucide. Submit → loading → report (claim ledger w/ drawers, framing + interactive transcript highlighting, context cards, perspectives, provenance footer). Verified live with Gemini data.
- [ ] **P1 — Auth UI.** Supabase client sign-in (Google + email); send access token as `Bearer`; show signed-in state.
- [x] **Share route page.** Public read-only report at `#/r/:slug`, backed by `GET /api/v1/r/:slug`. Share button copies the link.
- [ ] **P2 — CORS for production.** ~~Dev uses a Vite proxy...~~ **Minimal env-gated CORS added** (`CORS_ORIGIN`); set it + `VITE_API_BASE` in prod.
- [ ] **P2 — Polish:** error/empty states, mobile pass, light-mode parity, WCAG 2.2 AA audit.
- [ ] **P2 — Dispute / flag / save actions** in the UI once those endpoints exist.

---

## Technical debt (shortcuts that need hardening)

- [ ] **P1 — Naive source-tier classification.** Institutional allowlist in `tavily.ts` under-rates real sources (WRI, Frontiers, thejournal.ie, academic journals all read `tier3`). Upgrade to a real source-reliability dataset. ⚠️ licensing check needed for Ad Fontes / AllSides / MBFC before commercial use. *(evidence + perspective providers)*
- [ ] **P1 — Social-media domains qualify as perspectives.** ~~Tavily surfaced a Facebook post...~~ **Done** — perspective provider now filters out social domains (facebook/instagram/x/tiktok/etc.) before selection.
- [ ] **P2 — In-memory infra ceilings.** `InMemoryCache/Queue/Repository` are single-process, non-durable (marked with `ponytail:` comments). Resolved by the Neon + Upstash swap (see Infra). *(infra)*
- [ ] **P2 — Sequential evidence lookups.** `stages.ts` calls `evidence.gather` per claim in series (N API calls). Parallelize with a concurrency cap when latency matters. *(pipeline)*
- [ ] **P2 — Perspective topic = TLDR.** Bridging search uses the report TLDR as the query; a dedicated topic/query extraction could improve retrieval. *(perspective)*
- [ ] **P2 — No production build.** Runs via `tsx`; no `dist` build step yet. Add before deploy. *(build)*

---

## To-Do — Infra & persistence

- [x] **Repository → Neon Postgres.** Wired via `pg`; `npm run migrate` applies `001_init.sql`. Verified: reports survive a server restart.
- [x] **Cache + Queue → Upstash Redis.** URL-hash cache (ioredis) + durable BullMQ queue. Verified: cache hit on resubmit, jobs process.
- [~] **Persist the full report graph.** v1 stores the whole report as **JSONB** in `analysis_reports.data` (lossless). The normalized `claims`/`citations`/`perspective_links` tables are **reserved, not yet populated** — normalize them when analytics / channel-scorecards need cross-report queries.
- [x] **Store the raw transcript + title.** Now saved on the report (`transcript`, `title`) — powers interactive highlighting and the report header.
- [x] **`share_slug` public route.** `GET /api/v1/r/:slug` (public, no auth) + frontend `#/r/:slug` deep-link page + "Share / copy link" button. Verified end-to-end.
- [ ] **P2 — Fix `.env` REDIS_URL scheme.** It's `redis://`; Upstash is TLS-only. Code now auto-forces TLS for `*.upstash.io`, but change it to `rediss://` for correctness.
- [ ] **P2 — Stale `.env` PERSPECTIVE_PROVIDER.** Currently `newsapi` (falls back to mock). Set to `bridging` or `mock`.
- [ ] **P2 — pg SSL deprecation warning.** `sslmode=require` will change semantics in pg v9; pin `sslmode=verify-full` or `uselibpqcompat=true` when convenient.
- [ ] **P2 — Embedding dimension note.** Schema `vector(1536)` = OpenAI. Bridging needs no embeddings today; if added via Gemini (768), change the column.

---

## To-Do — Providers / pipeline

- [x] **Article extraction (Firecrawl).** `article` source type now extracts via Firecrawl (markdown, de-noised, capped at 24k chars). All three input types work.
- [~] **GDELT evidence link.** Wired into the chain (Fact Check → GDELT → Tavily) with graceful failure. ⚠️ GDELT free tier is rate-limited to **1 request / 5s**, so in a per-claim chain it mostly 429s and falls through to Tavily — effectively best-effort. Better fit: topic-level use, or a paid GDELT tier. Harmless as-is.
- [x] **Transcript title persisted.** All three providers return a title; stored on the report and shown in the header.
- [ ] **P2 — OpenAI via OpenRouter.** OpenAI key was dead; add OpenAI (and others) through OpenRouter as alternate LLM(s).
- [ ] **P2 — Watch-page caption fallback is effectively dead.** YouTube blocks server-side caption bodies (needs `pot` token). Kept only as a no-key fallback that errors helpfully. Remove or revisit if a `pot` path becomes viable.

---

## To-Do — Security (before any public exposure)

- [x] **Auth (Supabase).** `jose` HS256 verify against `SUPABASE_JWT_SECRET`. `optionalAuth` (anonymous allowed, valid token attaches `req.user`, bad token → 401) on `/api/v1`; `requireAuth` gates protected routes (`GET /me`). Rate limiting now keys per-user when logged in, else per-IP.
- [x] **Rate limiting.** Per-key/day limiter on `POST /analyses`, Redis-backed (in-memory fallback), counts only cache misses, sets `X-RateLimit-*` + `Retry-After`, 429 over limit. `trust proxy` set.
- [ ] **P1 — Sync Supabase users into the `users` table.** Auth verifies tokens but doesn't persist users yet; needed for saved reports, disputes, flags, institutional seats.
- [ ] **P1 — Secret hygiene.** Delete the inert duplicate `h:\f-Socials\.env` (canonical is `app/apps/server/.env`).
- [ ] **P2 — JWKS migration path.** If the Supabase project switches to asymmetric "JWT signing keys", swap HS256-secret verify for `jose.createRemoteJWKSet` against the project's JWKS endpoint.
- [ ] **P2 — Rate-limit hardening.** Higher limits for authenticated users; correct `trust proxy` hop count behind the real proxy; Redis INCR+EXPIRE is non-atomic (Lua script if it matters).
- [ ] **P2 — Protect mutating routes.** When dispute/flag/save endpoints are built, gate them with `requireAuth`.

---

## To-Do — Backend ↔ Frontend schema reconciliation

The backend report contract now matches the `frontendconcept` model. ✅ done this pass.

- [x] **Framing signals → multiple examples + char offsets.** `examples[{text, explanation, startIndex, endIndex}]`; offsets computed server-side via `indexOf` (verified: they slice back to the exact quote). Enables interactive transcript highlighting.
- [x] **Context gaps → Context Cards.** `contextCards[{title, description, sourceName?, sourceUrl?}]` (LLM supplies title+description; no fabricated sources).
- [x] **Provenance object.** `{model, analysisVersion, sourcePolicyVersion, reviewStatus, lastUpdated, disputesCount}` on every report.
- [x] **Store raw transcript + title** on the report (transcript for highlighting; title for the header — closes the old "title not persisted" debt).
- [~] **Claims `evidenceDescription`.** Optional field added to the type; `sourceBasis` now populated by the LLM. A prose "evidence review" is still not generated — derive from citations/evidence later if the UI wants it.
- [ ] **P2 — `evidenceStrength` vocab mapping.** Backend uses `strong|moderate|weak|none`; the prototype UI used `supported|mixed|weak|insufficient`. Map in the frontend (no backend change).

---

## To-Do — Product features not yet built (in spec)

- [ ] **P1 — Dispute flow.** `disputes` table in schema; no API/UI.
- [ ] **P1 — Expert review queue.** `/review/queue` + `/review/:id` (role-gated); `expert_reviews` table exists.
- [ ] **P1 — Community flagging (technique tagging).** `flags` table exists; no API/UI.
- [ ] **P2 — Saved analyses / collections / literacy profile.** `saved_reports` table exists; no API/UI.
- [ ] **P2 — Methodology page + source-policy page.** Launch-blocker content (trust moat).
- [ ] **P2 — Institutional workspace.** Pilot feature.

---

## Evaluation / tuning (needs real measurement, not blind changes)

- [ ] **Fact Check query strategy.** Full-sentence queries miss; shorter/keyword queries lift recall but risk less-relevant hits. A/B before changing.
- [ ] **Gemini model choice.** `3.1-flash-lite` (current primary) extracts fewer claims than heavier models (2 vs ~8 on the same transcript). A/B `3-flash-preview` as primary vs lite.
- [ ] **Evidence-strength heuristics.** Count-based mapping (capped at `moderate`) is humble-by-design; revisit once real usage data exists.
- [ ] **Bridging band thresholds.** `divergence ∈ [0.2, 0.85]`, `dehumanization ≤ 0.5` — picked sensibly, not measured.

---

## Design-side notes (from Design concepts review)

- [ ] **WCAG version.** Design docs reference 2.1 AA; concept targets 2.2 AA. Align on 2.2 AA.
- [ ] **Accent color.** `#00ffe5` (neon cyan) is high-chroma — slightly at odds with the "calm/muted, no verdict colors" principle. Worth a second look.
- [ ] **Schema-driven UI.** When building the frontend, drive it from the reconciled backend contract (above), not the prototype's mock shape.

---

## Housekeeping

- [x] Diagnostic scratch scripts cleaned up after each provider wiring.
- [ ] `scripts/probe.mjs` kept as a manual end-to-end checker (gitignored output).
- [ ] Consider a real test runner config if the suite grows (currently `node --test` with explicit file list).
