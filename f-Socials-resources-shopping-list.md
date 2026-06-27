# f-Socials — Resources Shopping List & To-Do

Adjusted to **your** chosen stack. Status legend:
✅ decided / have account · 🔑 need to generate key · 🔎 still evaluating · ⏳ deferred to later phase

> The scaffolded first slice runs with **zero external accounts** (mock providers + in-memory infra). The `.env.example` is now pre-populated with every key below, so you can fill it in one pass and the swap-in work later is just "implement the interface + flip the selector."

---

## Phase 0 — Run the first slice

- [x] Node.js (v25) + npm
- [x] Git
- [x] ✅ ESLint + Prettier (installed)
- [ ] 🔑 **GitHub** repo (private to start)

No API keys required. `npm install` → `npm test` → `npm run dev` works offline.

---

## Phase 1 — Make analysis real

### 1. LLM — claim extraction, framing, issue-frame
- ✅ **Google Gemini** (`GEMINI_API_KEY`) — leaning into the Google API collection.
- ✅ **OpenAI** (`OPENAI_API_KEY`) — second engine; also powers embeddings.
- Running both; selector `LLM_PROVIDER=gemini|openai`. Set a hard spend cap on each dashboard.

### 2. Embeddings — bridging-perspective vector match
- ✅ **OpenAI `text-embedding-3-small`** (1536 dims — matches the `vector(1536)` schema column).
- ⚠️ If you ever switch to Gemini `text-embedding-004` (768 dims), change that column in `001_init.sql`.

### 3. Transcription / speech-to-text
- ✅ **Deepgram** (`DEEPGRAM_API_KEY`, `nova-3`).
- Note: fetch existing YouTube caption tracks first (free via YouTube Data API); only send to Deepgram when captions are absent.

### 4. YouTube ingestion ✅ **working via Supadata**
- ✅ **Supadata** (`SUPADATA_API_KEY`) — wired & verified; returns full transcripts (prefers English, falls back to default track). This is the reliable path now.
- ⚠️ **Watch-page extraction** (no key) — kept as fallback; gets title + caption-track list but YouTube blocks the caption *body* server-side (empty 200, needs a `pot` token). Used only if no Supadata key.
- `YOUTUBE_API_KEY` (Data API v3) stays reserved for official metadata; not required.
- Bonus: Supadata also covers TikTok/Instagram transcripts via the same interface — useful if those input types are added later.

### 5. Article extraction
- ✅ **Firecrawl** (`FIRECRAWL_API_KEY`) — you have unused credits. Handles JS-heavy pages, returns clean content.

### 6. Database (Postgres + pgvector)
- ✅ **Neon** (`DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED` direct for migrations). Bundles pgvector.
- Possible alt: Railway Postgres if you end up deploying there — you have credits on both. DB choice and deploy choice are independent.

### 7. Cache + job queue
- ✅ **Upstash Redis** — you have credits. REST creds for the URL-hash cache; `rediss://` URL for the BullMQ job queue.

---

## Phase 2 — Evidence, perspectives & trust

### 8. Fact-check / evidence (now a **chain** — `EVIDENCE_PROVIDER=chain`)
Resolved by an ordered chain; first source with a hit wins. Status: **wired & verified**.
- ✅ **Google Fact Check Tools API** (`GOOGLE_FACTCHECK_API_KEY`) — authoritative, free, tier-2. Strong on famous claims; sparse + keyword-brittle on the long tail.
- ✅ **Tavily** (`TAVILY_API_KEY`) — broad web retrieval; fills the long tail Fact Check misses. Conservatively tiered (institutional allowlist → tier-2, else tier-3).
- [ ] 🔎 **GDELT** — planned **middle link** (Fact Check → GDELT → Tavily). Keyless, global news; you haven't used it — I'll slot it in when you want.
- **Tuning to-do:** Fact Check recall improves with shorter/keyword queries; Tavily's tier allowlist is naive (real news/academic sites currently read tier-3). Both need a real evaluation pass.

### 9. News search (bridging perspectives)
- ✅ **GDELT** as default (keyless, global, free) — selector `PERSPECTIVE_PROVIDER=gdelt`.
- 🔎 **NewsAPI** (`NEWS_API_KEY`) optional second source if you want tighter recency/queries.

### 10. Source bias/reliability metadata
- 🔎 Still evaluating. Start with your own published tiered source policy (concept §6.5); layer in a third-party dataset later.
- ⚠️ Licensing flag stands: confirm commercial-use terms before embedding Ad Fontes / AllSides ratings in a paid product.

---

## Phase 3 — Accounts, delivery & ops

### 11. Auth
- ✅ **Supabase Auth** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`).
- Email + Google OAuth are configured **in the Supabase dashboard**, not in env.
- Note: you flagged a bad Neon Auth experience (~1yr ago) — Supabase Auth sidesteps that entirely. Neon stays as the Postgres data store only.

### 12. Hosting / deploy
- ✅ Flexible — you have **Vercel** + **Railway** + **Supabase** credits.
  - **Web app:** Vercel (preferred for React).
  - **API + worker:** Railway (the worker is long-running — keep it off serverless).
  - **DB:** Neon (or Railway Postgres if you consolidate).
- Decide web-vs-api hosting split when the React app exists; nothing blocks it now.

### 13. Transactional email
- ⏳ Deferred. Supabase handles auth emails out of the box. Add **Resend** later only when you build weekly digests.

### 14. Error monitoring + analytics
- ✅ **Sentry** (`SENTRY_DSN`) — you have credit.
- ✅ **PostHog** (`POSTHOG_API_KEY`, `POSTHOG_HOST`) — events/funnels for the KPI + red-line metrics.

### 15. Domain
- 🔎 TBD. Cloudflare Registrar (at-cost + DNS/CDN) when you're ready.

---

## Non-technical to-do (the trust moat — you're starting these)

- [ ] **Methodology page content** — plain-language scoring + the §6.5 source policy. Launch blocker.
- [ ] **Privacy policy + Terms** — GDPR-aligned; disclose automated processing + appeal path.
- [ ] **AI Act / legal review** — confirm advisory-only stays out of high-risk classification.
- [ ] **EDMO / BENEDMO outreach** — start early; partnerships take months.
- [ ] **Source-tier policy doc** — publish before the critics arrive.
- [ ] **Pilot prospects list** — 5–10 educators / libraries / NGOs to co-design the institutional workspace.

---

## Your minimum viable paid stack

| Need | Your pick | ~Monthly at MVP scale |
|---|---|---|
| LLM | Gemini + OpenAI | usage (caps set) |
| Embeddings | OpenAI 3-small | usage (tiny) |
| Transcription | Deepgram | usage |
| Article extraction | Firecrawl | existing credits |
| DB + vector | Neon | free → usage |
| Cache/queue | Upstash | existing credits |
| Fact-check + news | Google Fact Check + GDELT | free |
| Auth | Supabase | free → $25 |
| API+worker host | Railway | credits |
| Web host | Vercel | free → $20 |
| Errors / analytics | Sentry / PostHog | existing credit |

Most of this is covered by credits or free tiers. Set spend caps on Gemini, OpenAI, and Deepgram from day one.

---

## Swap points (mock → your real services)

Each swap = implement one interface + flip its selector in `.env`. No core changes.

| Interface | Mock (now) | Your swap | Selector |
|---|---|---|---|
| `TranscriptProvider` | passthrough | **router**: paste ✓ · YouTube via Supadata ✓ · article via Firecrawl ✓ | by input type |
| `LLMProvider` | sentence splitter | Gemini / OpenAI | `LLM_PROVIDER` |
| `EvidenceProvider` | mock citation | **chain: Fact Check → Tavily** (GDELT later) | `EVIDENCE_PROVIDER` |
| `PerspectiveProvider` | mock links | **bridging**: Tavily (retrieval) + Gemini (rule scoring) | `PERSPECTIVE_PROVIDER` |
| `Cache` | in-memory | Upstash Redis | `CACHE_DRIVER` |
| `Queue` | in-memory | Upstash + BullMQ | `QUEUE_DRIVER` |
| `Repository` | in-memory | Neon Postgres | `REPO_DRIVER` |
