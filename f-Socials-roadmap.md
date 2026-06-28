# f-Socials — Roadmap & Directional Strategy

**Committed roadmap.** Synthesizes the three research docs in `Feedback-roadmap options- directional strategy/`, the settled `f-Socials-refined-concept.md`, the `f-Socials-v1-product-definition.md`, and a verified read of the actual codebase (not the stale README).

> Compass: **f-Socials is a lens, not a judge.** Every item below answers to that.
> Status legend: `[ ]` open · `[~]` partial · `[x]` done · **P0** before public/real use · **P1** soon · **P2** later.

---

## 1. Reality check — where we actually are

The README and "not built yet" notes read like an early prototype. The code does not. Verified state:

- **The engine is real and proven end-to-end.** Gemini extraction · Supadata/Firecrawl transcripts · Google Fact Check → GDELT → Tavily evidence chain · bridging perspectives · Neon Postgres · Upstash Redis + BullMQ · Supabase JWT auth · per-key rate limiting · cache-first hashing · the invariant gate · a live React report page (claim drawers, interactive transcript highlighting, issue-frame spectrum, provenance footer, public share route). The **trust-and-launch bundle** then added the transparent source-tier policy, the Methodology page, dispute/flag intake, the accessibility pass, and the real production build. The **claim-verification-router** rebuilt Stage 3's evidence step into a precision pipeline (normalize → triage → query pack → retrieve → validate → outcome) wrapped around the same provider chain — citing only evidence that actually matches a claim, reporting an honest "no sufficient evidence found" otherwise, persisting a lossless per-claim audit record, guarding the invariant gate at worker boot, and shipping an offline False-Evidence-Rate benchmark + Ship_Gate. Then **report-graph-normalization** landed the committed dual-write (§7): every saved report now also projects into the normalized `claims`/`citations`/`perspective_links` tables for cross-report analytics, additively and best-effort, with a backfill for older JSONB-only reports — the data layer the first aggregate feature will sit on. Most recently, **parallel-evidence-lookups** removed the last serial bottleneck: Stage 3's claim loop and the router's Query_Variant loop now run under one shared per-report counting semaphore (configurable `CONCURRENCY_CAP`, default 4), bounded so concurrent provider submissions never exceed the cap — output ordering, error isolation, and the invariant gate are preserved by construction (verified, not weakened). All backed by a green test suite (server unit + property tests, web Vitest + property tests, plus build-smoke and degraded-controls integration checks).
- In the language of `f-Socials feedback.md`, **Slice 1 — "prove the engine" — is essentially done.** The artifact exists, so the question "can f-Socials produce an analysis users find useful, fair, inspectable, and share-worthy?" is now answerable with a real shared URL, not a mockup.

**Therefore the real problem is not "what to build" — it's "ship and earn trust, in order."** This doc is ordered around that.

---

## 2. The one strategic tension (resolved)

The research docs disagree. Following all of them rebuilds the scope creep already cut. Resolution holds the line set in `f-Socials-refined-concept.md`:

| Recommendation (from `Architectural & Code Structure Recommendations.md`) | Decision | Why |
|---|---|---|
| Creator Accountability Profiles / "nutrition labels for influencers" | **Cut, stays cut** | Defamation magnet; breaks neutrality. The single most dangerous idea in the research pile. |
| Browser extension as *primary* ingestion engine, now | **Deferred to read-only, months 12–18** | Manifest V3 + audio capture + Meta/TikTok cat-and-mouse is a legal/maintenance bog. Cache-first URL/paste is the right v1. |
| Microservices rewrite | **No** | The modular monolith + swappable provider interfaces + separate worker already delivers ~90% of the benefit at ~10% of the ops cost. Split a stage out only when its scaling profile forces it (transcription first, later). |

The genuinely good, non-conflicting borrowings — Ground News "blindspot," Community Notes bridging, NewsGuard-style **source** (not creator) labels, AllSides L/C/R framing, "no sufficient evidence found" as an honest outcome — are already compatible with the lens and are folded into §6.

---

## 3. The "something extra" (the defensible differentiators)

Name these sharply; they drive prioritization and marketing.

1. **The invariant gate is a codified moat.** Competitors claim neutrality in a blog post; f-Socials enforces "no claim asserts evidence strength it can't cite, no framing signal without an inspectable quote" *in code* (`core/assemble.ts`), with a test that fails the build if weakened.
   - **Refinement:** the implementation is *better* than the spec — it correctly allows an honest `evidenceStrength: 'none'` + zero-citations state ("no external review found"). **Update the product-definition wording to match the code**, not the other way around.
   - **Hardened by the claim-verification-router:** the router is engineered to satisfy the gate *by construction* (strength ≠ `none` ⇔ ≥1 citation), and a runtime boot guard (`assertInvariantGateIntact()`) re-verifies the gate's pinned behavior at worker start — the moat is now defended behaviorally at boot, not only by code review.
2. **Precision over recall, measured.** The claim-verification-router separates broad recall retrieval from strict precision validation and never lets a near-miss masquerade as evidence — every candidate is classified against the *original* claim, and an `excluded` source tier is a hard non-evidence gate. The governing metric is an explicit, offline-measured **False_Evidence_Rate** with a Ship_Gate, not a vibe. "A wrong citation is worse than a missing one" is now an enforced engineering bar.
3. **Framing-as-inoculation, evidence-on-demand.** Per-span framing technique naming tied to the exact highlighted transcript quote. No one in the competitive set does this.
4. **Cache-first unit economics.** Hash a viral video once, serve it to everyone — what makes a free public tier survivable, which feeds the institutional funnel.

---

## 4. Short-term roadmap (~6–8 weeks): "shippable and trusted"

Principle: **trust surfaces before account surfaces.** The engine being done made this fast. Status: the **trust-and-launch-bundle spec delivered the P0/P1 technical items below** (transparent source-tier policy, Methodology page, dispute/flag intake, production build + safe deploy config, and the UI/accessibility pass), and **parallel-evidence-lookups closed the evidence-parallelization perf item**. The non-technical educator outreach remains open.

- [x] **P0 — Methodology page (launch blocker).** Static, plain-language `#/methodology` route (no auth): how evidence outcomes are distinguished and what raises/lowers confidence, the §6.5 source-tier policy + open signals with the live version, who reviews reports and each review status, how to dispute, the neutrality statement, glossary terms on first use. Linked from every report's provenance footer; degrades gracefully if `/policy` is unreachable.
- [x] **P0 — Source-tier credibility upgrade (biggest credibility risk).** Replaced the naive Tavily allowlist with a transparent, versioned policy (`core/sourceTier.ts`) that is **authoritative over provider guesses** in the pipeline and served at `GET /api/v1/policy`.
  - Licensing resolved by **avoiding** encumbered datasets entirely: seeded from **open signals only** (IFCN signatory list, an institutional domain registry + `.gov`/`.gov.*`/`.mil`/`.edu`/`.ac.*`/`.int` suffix rules, press-council membership). No Ad Fontes / AllSides / MBFC. A provenance test asserts none of those datasets are referenced and that the policy carries no creator dimension.
- [x] **P1 — Dispute + flag endpoints and UI.** `POST /analyses/:id/disputes` (anonymous, no user identity) and `POST /analyses/:id/flags` (`requireAuth`, technique must match a framing technique in the report) + a focus-trapped dispute modal and footer control. New `Repository.createDispute/createFlag` (memory + Postgres) and migration `002` (`disputes.claim_id`). Review *workflow* still intentionally lags the intake.
- [x] **P0 — Production build + deploy config.** Real build (`tsc --noEmit` type gate → `tsup` emit to runnable `dist/*.js`, no `tsx` at runtime); API and worker split into separate long-running entrypoints (`index.ts` / `worker.ts`) sharing one composition root (`compose.ts`); origin-checked CORS (`allowOrigin`); startup config validation that exits naming the missing value, with access controls degrading-and-warning (fail closed) rather than blocking. Railway/Vercel deploy itself (setting the env on the hosts) is the remaining ops step.
- [x] **P1 — UI polish + accessibility pass.** Empty/error states with Retry/Back (never a partial report), responsive single-column ≤768px, AA-targeted contrast audit of the CSS variables in both themes, color-never-alone text labels, keyboard-operable claim drawers/framing tabs/modal with focus trap + restore, ARIA descriptions on framing highlights, screen-reader text for issue-frame positions, and the accent standardized to the muted teal `#0d9488` (the `#00ffe5` neon cyan is gone). *Full WCAG 2.2 AA conformance still needs manual browser/AT review — the automated checks cover ARIA wiring + the variable audit, not real pixel contrast.*
- [x] **P1 — Parallelize evidence lookups.** **Shipped (parallel-evidence-lookups).** Stage 3's claim loop (`pipeline/stages.ts`) and the router's Query_Variant loop (`router/index.ts`) now run under **one shared per-report counting semaphore** (`src/concurrency.ts`), bounded by a configurable `CONCURRENCY_CAP` (default 4, valid `[1,32]`, warn-and-default on invalid). One gated retrieve = one provider submission, so concurrent provider submissions never exceed the cap by construction. Determinism is preserved by writing results into pre-sized index arrays and flattening in index order; error isolation reproduces the serial defaults exactly (no new calls, no retries); `cap=1` collapses to the exact serial baseline; `core/assemble.ts` and `makeRetrieve` are verify-only (untouched). The p95 ≤ 30s ship gate is supported by a `runLatencyBenchmark` + `LatencyBenchmarkReport` (`pass`/`fail` verdict) added to the benchmark runner. Eight `fast-check` properties (output-equivalence, error isolation, in-flight cap, cost-neutrality, honest-none, latency reduction, p95 reporting, cap resolution) at ≥100 runs each. *(not part of the trust bundle or the router spec)*

**In parallel, non-technical — top priority per `f-Socials feedback.md`:**
- [ ] **P0 — Talk to 5–10 educators / libraries / NGOs now.** Not "do you like it" — "would you use this with a group next month, and what would stop you?" Show a real shared report URL. This conversation reorders everything after it.

**Explicitly NOT short-term:** accounts/save/history (Slice 2, once repeat use is visible) · institutional workspace · expert review *queue UI* · extension. The dispute/flag *intake* ships now; the *review workflow* can lag.

---

## 5. Long-term roadmap (phased, aligned to the concept's 18-month arc)

| Phase | Focus |
|---|---|
| **Pilots** | ~~Normalize the report graph (§7)~~ **done** · expert review queue UI · institutional workspace (shared collections, classroom annotation) · accounts/save/history · EN/NL localization · EDMO/BENEDMO outreach for the human-review layer via partnership, not payroll |
| **Read-only extension** | Surfaces *existing* reports on a page — no reranking. Earns trust on a feed surface before touching ranking. |
| **Intervention & scale** *(gated on trust metrics + legal review)* | Feed Friction Dial (Wedge B) · public/GraphQL API for institutions (a real secondary revenue line — the one strong B2B idea from the architecture doc) · creator pre-publish coaching. Each gated, never assumed. |

---

## 6. Feature set — keep / add / cut, against the lens

| Borrowed from | Adopt as | Verdict |
|---|---|---|
| Community Notes | Bridging selection rule (already built) + corroborated community flags | **Keep / strengthen** |
| Ground News blindspot | Descriptive "covered from one angle" note on the perspectives tab | **Add (light)** |
| NewsGuard | Nutrition label on **sources**, in citations (tier/reliability chip) | **Done** — source-tier chip renders the tier label (never a creator) |
| AllSides | Spatial issue-frame chips (`issueFrameLabel`) | **Keep** |
| Truth Goggles / inoculation games | Gamified technique-spotting → literacy markers | **Add later (Slice 2+)** |
| "Context Gaps" naming | "Useful Context" (already renamed in UI) | **Done** |
| Creator nutrition labels / ranking | — | **Cut, stays cut** |
| Feed reranking | — | **North star, gated to 18+** |

---

## 7. Architecture & code structure recommendations

Bones are good. Targeted moves, not a rewrite.

- [x] **Normalize the report graph (key next-phase debt — done).** Reports are stored as JSONB in `analysis_reports.data` (still the lossless render payload); the reserved `claims`/`citations`/`perspective_links` tables are now **populated by a dual-write**. Every Ground-News-like aggregate (blindspot clustering, "this claim appeared in N reports," topic pages) needs cross-report queries JSONB can't serve cheaply, so this landed *before* the first aggregate feature, as planned. **Delivered by report-graph-normalization:** a pure `projectReportGraph` projection folded into `Repository.saveReport` (memory + Postgres), migration `004` (adds `claim_uid` + the `(report_id, claim_uid)` natural key + cross-report indexes), an idempotent best-effort normalized write (a failure never damages the served JSONB), and a one-shot backfill for pre-feature reports. No creator dimension; invariant gate verified, not touched.
- [~] **P1 — Add audit columns now (cheap).** **Partially delivered by the claim-verification-router:** a new `audit_records` table (migration `003`) persists one lossless per-claim decision record — Original/Canonical claim, `claim_type`, fact-checkability, the Query_Pack, every raw candidate with its Match_Type/confidence/Source_Tier/retrieval-rank, and the final Evidence_Outcome — so a disputed *evidence* decision is now reproducible. Still open: the cheaper denormalized columns on `analysis_reports` (`prompt_version`, `model_provider`, `model_name`, `analysis_policy_version`) and on `citations` (`retrieved_at`, `archived_url` — pages rot).
- [x] **One LLM provider in production, interface for two.** `selectLLM` already supports the swap. Run Gemini alone in prod; don't pay the dual-provider testing/prompt-drift/cost tax until there's a concrete reason (cost, latency, accuracy A/B).
- [ ] **P1 — Observability before pilots.** Wire Sentry + PostHog (already on the shopping list). The red-line trust KPIs (citation coverage, model-vs-human agreement) can't be measured without event capture.
- [x] **Keep the modular monolith.** Provider interfaces already give the seams that matter. Ignore the microservices push.

---

## 8. UI/UX recommendations

The live report page is functional; the gap to "accessible and inclusive for a diverse audience" is progressive disclosure and reduced cognitive load, not a redesign.

- [ ] **Reuse the mockup's visual language, keep the live app's data wiring.** The richer prototype (`Design concepts/mockup designs/.../components/report/*`) was simplified into tabs in the live app. The live app is schema-correct and wired to real data — **keep it**; port the mockup's calmer card styling + "Why included" rationale blocks onto it. Do **not** fork back to the prototype's mock shape (per the debt ledger).
- [ ] **Progressive disclosure is the inclusivity lever.** Lead with TLDR + the single most important framing signal (soft amber underline); everything else behind expandable drawers (the drawer pattern already exists). A diverse, non-technical audience bounces off a wall of tabs/tiers but stays for one clear sentence with a "show me why."
- [ ] **Borrow, mapped to the lens:** Ground News blindspot → "covered from one angle" note (descriptive, not accusatory) · AllSides → spatial frame chips (not verdicts) · NewsGuard → source tier/reliability chip in citations, never on creators.
- [x] **Accessibility as a first-class pass:** text labels beside every color signal · keyboard-navigable drawers/tabs · ARIA on AI tooltips · screen-reader-friendly rendering of the issue-frame chart · the accent standardized to `#0d9488`. Shipped in the trust-and-launch bundle. EN/NL localization slots in here (still open). Target **WCAG 2.2 AA** — automated ARIA + contrast-variable checks pass; full conformance still needs manual browser/AT review.

---

## 9. The order, in one line

> ~~Ship the **methodology page + source-tier fix**, deploy the public lens **safely**, wire **dispute/flag intake**~~ — **done.** ~~Parallelize evidence lookups~~ — **done.** Remaining: **talk to five educators** and deploy to Railway/Vercel. That converts a working, defensibly-trustworthy engine into a validated, publicly-running one. Everything else is earned after.

---

## 10. Cross-references

- Settled direction: `f-Socials-refined-concept.md`
- Execution spec (schema, routes, job contract, screens): `f-Socials-v1-product-definition.md`
- Live debt/TODO ledger (single source of truth for what's wired): `f-Socials-debt-and-todo.md`
- Accounts/keys/stack: `f-Socials-resources-shopping-list.md`
- Source research: `Feedback-roadmap options- directional strategy/`
