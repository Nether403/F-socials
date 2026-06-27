# f-Socials — Technical Debt & To-Do Ledger

A running overview of shortcuts taken, things deferred, and what's not built yet.
Updated as we go. Priorities: **P0** = before public/real use · **P1** = soon, for a real product · **P2** = nice-to-have / later.

> This ledger is the live source of truth for **build state**. For prioritized sequencing and strategy (what to do next and why), see `f-Socials-roadmap.md`.

> Legend: `[ ]` open · `[~]` partially done · `[x]` done. Each item tags where it came from.

---

## Current pipeline state (snapshot)

| Stage | Status |
|---|---|
| Transcript | **real** — paste ✓ · YouTube via Supadata ✓ · article via Firecrawl ✓ |
| LLM extraction | **real** — Gemini 3.1-flash-lite + model fallback ✓ |
| Evidence | **real** — chain (Google Fact Check → GDELT → Tavily) wrapped by the **claim-verification-router**: normalize → triage → query pack → retrieve → validate → outcome. Cites only evidence that matches the claim; honest "no sufficient evidence found" otherwise ✓ |
| Perspectives | **real** — bridging: Tavily + Gemini ✓ |
| Infra (cache/queue/repo) | **real** — Neon Postgres + Upstash (cache + BullMQ), verified durable across restart |
| Auth / rate limiting | **both ✓** — Supabase JWT verify (optional auth + `requireAuth`), per-user/per-IP rate limiting |
| Source-tier policy | **real ✓** — transparent versioned classifier from open signals, authoritative in the pipeline, served at `GET /api/v1/policy` |
| Dispute / flag intake | **real ✓** — anonymous disputes · authenticated technique flags (memory + Postgres + migration 002) |
| Build / process split | **real ✓** — `tsc` type gate + `tsup` emit; API (`index.ts`) and worker (`worker.ts`) split; startup config validation; origin-checked CORS |
| Frontend | **report page + methodology + dispute modal live** (`apps/web`) — submit · loading · report · share · `#/methodology` · dispute/flag/save with auth prompt; accessibility pass (color-never-alone, ARIA, keyboard/focus, ≤768px) |

Verified end-to-end with all real analysis providers + a clickable React UI. Backend unit + property tests and the web Vitest + property suite are green (plus build-smoke and degraded-controls integration checks run separately). The server suite is at 88 passing and `tsc --noEmit` is clean after the claim-verification-router landed.

---

## Claim-verification-router (precision evidence) — shipped

Replaces Stage 3's old "first provider with citations wins" `evidence.gather` loop with a staged precision pipeline wrapped around the **existing** provider chain, inside the existing Worker/Pipeline (no new microservice, no weighted scoring, no 8-variant query explosion). The governing metric is the **False_Evidence_Rate** — a wrong citation is worse than a missing one.

- [x] **Six-stage router** (`src/router/`): `normalize` (Claim_Type + Fact_Checkability triage), `queryPack` (4–6 purpose-distinct variants), `retrieve` (over the existing chain, tier set from the policy), `validate` (each candidate classified against the **original** claim, never a query variant), `outcome` (gates + routing + Evidence_Outcome), `audit`, and the `verifyClaim` orchestration.
- [x] **Three independent binary gates, no combined score** — Match_Type, Match_Confidence, and Source_Tier are recorded as distinct signals; only `same_claim` / `contradictory_but_relevant` candidates whose tier is **not** `excluded` enter the Claim_Ledger. `same_topic_different_claim` → Useful_Context; `background_context` → Context_Card; `irrelevant` discarded.
- [x] **Honest no-evidence.** `no_sufficient_evidence` (and `relevant_context_only`) carry zero citations and remain a valid served `ready` outcome; a single unmatched claim never fails the report.
- [x] **Invariant gate preserved + boot guard.** `core/assemble.ts` is unchanged; the router satisfies the gate by construction (strength ≠ `none` ⇔ ≥1 citation), and `assertInvariantGateIntact()` runs once at worker boot, refusing to start if the gate's pinned behavior ever weakens.
- [x] **Per-claim audit records persisted.** New `audit_records` table (migration `003`) + `Repository.saveAuditRecord` (memory + Postgres, best-effort so it never blocks a ready report). Each record is lossless: Original/Canonical claim, Claim_Type, fact-checkability, the Query_Pack, every raw candidate with Match_Type/confidence/Source_Tier/rank, and the final Evidence_Outcome.
- [x] **Neutrality enforced.** Static checks assert no Ad Fontes / AllSides / MBFC dataset is imported and that `VerifiedClaim`/`AuditRecord` expose no content-truth verdict or creator-reliability field.
- [x] **Tests.** All 16 correctness properties as `fast-check` PBTs (≥100 runs each, seeded deterministic normalizer/validator mocks so the router's logic — not the LLM — is under test), plus example/integration/neutrality tests. `fast-check` added as a dev dependency.
- [~] **Offline benchmark + Ship_Gate.** `src/router/benchmark/` computes `False_Evidence_Rate` per strategy (`current_chain` vs `router`, extraction model held constant) with a Ship_Gate (`FER_router ≤ FER_current`). The router is wired **live**; the current `fixtures.json` (~92 claims) uses synthetic `.example` URLs, so **running the benchmark on a real labeled set is the next step before relying on the gate decision in production** (folds into the educator-pilot labeled-claim collection).

---

## Frontend (apps/web)

- [x] **Scaffold + report page.** Vite + React 19 + TS, design tokens, Lucide. Submit → loading → report (claim ledger w/ drawers, framing + interactive transcript highlighting, context cards, perspectives, provenance footer). Verified live with Gemini data.
- [x] **Share route page.** Public read-only report at `#/r/:slug`, backed by `GET /api/v1/r/:slug`. Share button copies the link.
- [x] **CORS for production.** Origin-checked predicate (`http/cors.ts` `allowOrigin`): request origin matching `CORS_ORIGIN` → ACAO set + proceed; present-but-mismatched → 403, no ACAO; same-origin → proceed. Set `CORS_ORIGIN` + `VITE_API_BASE` in prod.
- [x] **Polish:** error/empty states (with Retry/Back, never a partial report), ≤768px single-column, contrast-variable audit in both themes, color-never-alone labels, ARIA, keyboard/focus. Full WCAG **2.2 AA** conformance still needs a manual browser/AT review (automated checks cover ARIA wiring + the variable audit, not real pixel contrast).
- [x] **Dispute / flag / save actions** in the UI — footer dispute control + focus-trapped modal, per-signal flag, and save; flag/save gated behind an auth prompt (no client-side auth flow yet, so the prompt always shows; the server still enforces `requireAuth`).
- [ ] **P1 — Auth UI.** Supabase client sign-in (Google + email); send access token as `Bearer`; show signed-in state. *(Until this lands, the Flag/Save controls only ever show the sign-in prompt.)*

---

## Technical debt (shortcuts that need hardening)

- [x] **Source-tier classification → transparent open-signal policy.** The naive Tavily allowlist is superseded by `core/sourceTier.ts` — a pure, versioned classifier seeded from open signals (IFCN signatory list, an institutional domain registry + `.gov`/`.gov.*`/`.mil`/`.edu`/`.ac.*`/`.int` suffix rules, press-council membership). Applied authoritatively in `pipeline/stages.ts` (overwrites whatever tier a provider guessed) and served at `GET /api/v1/policy`. No Ad Fontes / AllSides / MBFC — licensing sidestepped by using only open data; a provenance test enforces it. *(evidence + perspective providers)*
- [ ] **P1 — Social-media domains qualify as perspectives.** ~~Tavily surfaced a Facebook post...~~ **Done** — perspective provider now filters out social domains (facebook/instagram/x/tiktok/etc.) before selection.
- [ ] **P2 — In-memory infra ceilings.** `InMemoryCache/Queue/Repository` are single-process, non-durable (marked with `ponytail:` comments). Resolved by the Neon + Upstash swap (see Infra). *(infra)*
- [ ] **P2 — Sequential evidence lookups (now per-variant).** `stages.ts` runs the claim-verification-router per claim in series, and the router submits each Query_Variant to the chain sequentially (≤6 variants/claim, with a per-variant result cap). Parallelize across claims and/or variants with a concurrency cap when latency matters. *(pipeline / claim-verification-router)*
- [ ] **P2 — Perspective topic = TLDR.** Bridging search uses the report TLDR as the query; a dedicated topic/query extraction could improve retrieval. *(perspective)*
- [x] **Production build + process split.** `tsc --noEmit` type gate then `tsup` emits runnable `dist/index.js` + `dist/worker.js` (no `tsx` at runtime). API and worker are separate long-running entrypoints sharing one composition root (`compose.ts`); `RUN_WORKER_IN_PROCESS` keeps the single-process experience in dev. Startup validation exits naming any missing required deployed config; access controls degrade-and-warn (fail closed). A build-smoke test verifies the dist entrypoints boot and that the type gate fails on a deliberate error. *(build)*

---

## To-Do — Infra & persistence

- [x] **Repository → Neon Postgres.** Wired via `pg`; `npm run migrate` applies `db/migrations/*.sql` (now `001_init.sql` + `002_dispute_claim_id.sql` + `003_audit_records.sql`). Verified: reports survive a server restart.
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
- [x] **Protect mutating routes.** Flag intake is gated by `requireAuth` (anonymous → 401, never persisted); disputes are intentionally anonymous (no user identity). Both validate the body and 404 on a nonexistent report before writing. Save, when its endpoint is built, inherits the same auth gate.

---

## To-Do — Backend ↔ Frontend schema reconciliation

The backend report contract now matches the `frontendconcept` model. ✅ done this pass.

- [x] **Framing signals → multiple examples + char offsets.** `examples[{text, explanation, startIndex, endIndex}]`; offsets computed server-side via `indexOf` (verified: they slice back to the exact quote). Enables interactive transcript highlighting.
- [x] **Context gaps → Context Cards.** `contextCards[{title, description, sourceName?, sourceUrl?}]` (LLM supplies title+description; no fabricated sources).
- [x] **Provenance object.** `{model, analysisVersion, sourcePolicyVersion, reviewStatus, lastUpdated, disputesCount}` on every report.
- [x] **Store raw transcript + title** on the report (transcript for highlighting; title for the header — closes the old "title not persisted" debt).
- [~] **Claims `evidenceDescription`.** Optional field added to the type; `sourceBasis` now populated by the LLM. A prose "evidence review" is still not generated — derive from citations/evidence later if the UI wants it.
- [x] **`evidenceStrength` vocab mapping → owned by the claim-verification-router.** The router defines deterministic, total mappings `Evidence_Outcome → Evidence_Strength` (`strong|moderate|weak|none`) and `Evidence_Outcome → prototype vocab` (`supported|mixed|weak|insufficient`, with a `mixed` override when a matched claim carries both supporting and contradicting citations), reconciling the two vocabularies in the backend. *(claim-verification-router)*

---

## To-Do — Product features not yet built (in spec)

- [x] **Dispute flow.** `POST /analyses/:id/disputes` (anonymous, no user identity, `disputes.claim_id` via migration 002) + footer control and focus-trapped modal; confirmation on success, inline error keeps the modal open on failure.
- [ ] **P1 — Expert review queue.** `/review/queue` + `/review/:id` (role-gated); `expert_reviews` table exists. *(intake exists; review workflow still lags)*
- [x] **Community flagging (technique tagging).** `POST /analyses/:id/flags` (`requireAuth`, technique must match a framing technique in the report) + per-signal flag control with an auth prompt for anonymous users.
- [ ] **P2 — Saved analyses / collections / literacy profile.** `saved_reports` table exists; Save control is wired in the UI (auth-gated) but has no persistence endpoint yet.
- [x] **Methodology page + source-policy page.** `#/methodology` (no auth) covering evidence outcomes, the source-tier policy + open signals with the live `/policy` version, review statuses, how to dispute, the neutrality statement, and glossary terms; degrades gracefully if `/policy` is unreachable.
- [ ] **P2 — Institutional workspace.** Pilot feature.

---

## Evaluation / tuning (needs real measurement, not blind changes)

- [~] **Fact Check query strategy → addressed by the claim-verification-router.** The router replaces the single full-sentence query with a purpose-distinct Query_Pack (exact normalized / compressed entity-predicate / fact-check-style / counterclaim-negated, + source-language/English for non-English topics) and a strict post-retrieval validator, and ships an offline benchmark measuring **False_Evidence_Rate** per strategy with a Ship_Gate (`FER_router ≤ FER_current`). Remaining: run the benchmark on a **real labeled set** (current `fixtures.json` uses synthetic URLs) before relying on the gate decision in production.
- [ ] **Gemini model choice.** `3.1-flash-lite` (current primary) extracts fewer claims than heavier models (2 vs ~8 on the same transcript). A/B `3-flash-preview` as primary vs lite. *(Note: the claim-verification-router benchmark deliberately holds the extraction model constant — Req 8.6 — so this confound can't distort a router-vs-chain comparison.)*
- [ ] **Evidence-strength heuristics.** Count-based mapping (capped at `moderate`) is humble-by-design; revisit once real usage data exists.
- [ ] **Bridging band thresholds.** `divergence ∈ [0.2, 0.85]`, `dehumanization ≤ 0.5` — picked sensibly, not measured.

---

## Design-side notes (from Design concepts review)

- [~] **WCAG version.** Aligned: design docs now state **WCAG 2.2 AA**. The accessibility pass shipped (color-never-alone, ARIA, keyboard/focus, responsive ≤768px, contrast-variable audit); full conformance still needs a manual browser/AT review — automated checks cover ARIA wiring and the CSS-variable audit, not real pixel contrast.
- [x] **Accent color.** The neon cyan `#00ffe5` is removed; the brand accent is the muted teal `#0d9488` (the evidence-backed/success token) in `tokens.json` and `styles.css`, matching the "calm, no-verdict colors" principle. A smoke test asserts no `#00ffe5` remains.
- [ ] **Schema-driven UI.** When building the frontend, drive it from the reconciled backend contract (above), not the prototype's mock shape.

---

## Housekeeping

- [x] Diagnostic scratch scripts cleaned up after each provider wiring.
- [ ] `scripts/probe.mjs` kept as a manual end-to-end checker (gitignored output).
- [ ] Consider a real test runner config if the suite grows (currently `node --test` with explicit file list).
