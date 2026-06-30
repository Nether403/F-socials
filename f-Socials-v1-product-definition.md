# f-Socials — v1 Product Definition

**Execution spec for the Foundation phase (months 0–6).** Not an essay. This is what gets built.

> Compass: **f-Socials is a lens, not a judge.** Every decision below answers to that.
> Scope: **paste link → inspect claims & framing → see credible alternatives → share report.** Nothing else ships in v1.
>
> **Status (build):** the Foundation engine in §2–§5 and §7 (steps 1–8) is **built and proven end-to-end** — real providers, durable infra, auth, rate limiting, the invariant gate, and a live report + share UI. The v1 surfaces once listed as remaining are now **all shipped**: the methodology page, dispute/flag intake, the expert review queue + Reviewer Console, accounts/save + reverse-chronological history, and the client-side auth flow. Slice 2 ("Pilots") work has also landed — institutional workspaces, EN/NL localization, the progressive-disclosure report UI, the intervention & scale capabilities (dark by default), and **Supabase user sync** (the flag `users(id)` FK seam, migration `009`). `f-Socials-debt-and-todo.md` is the live build-state truth; `f-Socials-roadmap.md` holds the sequencing.

---

## 1. The product contract

### 1.1 Target users
| User | Role in v1 | Why |
|---|---|---|
| **Media-literacy educators, libraries, NGOs** | Paying beachhead | Clear budgets, impact stories, calm usage |
| **Curious public users** | Free engine | Acquisition, virality, impact proof via shareable reports |

### 1.2 Inputs (v1 only)
- YouTube URL (official Data API + caption track)
- Article URL (readable-web extraction)
- Pasted transcript / plain text (≤ 20k chars)

> Deferred, not built: TikTok / Instagram / Facebook live ingestion. If a user pastes one of those URLs, prompt them to paste the transcript instead.

### 1.3 Outputs (the report)
1. **TLDR** — 2–3 sentence plain-language summary.
2. **Claim Ledger** — extracted claims, each with verifiability, evidence strength, source basis, confidence, and citations.
3. **Framing Signals** — named techniques (outrage framing, truncated quote, omits cited context…) each with **expandable evidence** (the exact span + what's missing + source).
4. **Context Gaps** — widely-reported facts the content omits.
5. **Bridging Sources** — 3–5 topic-matched, moderately divergent, Tier‑2+ sources (per §6.5 of the concept doc).
6. **Provenance footer** — which layer produced/last-updated this (AI / expert / community), version, timestamp.

### 1.4 What the product REFUSES to do (hard guardrails)
- ❌ No single "truth score" or any global content score.
- ❌ No creator/channel ranking or reputation scoring.
- ❌ No feed reading, reranking, or intervention.
- ❌ No framing cue without inspectable evidence.
- ❌ No claim asserting an evidence strength it cannot cite. *(A claim with no external review is shown honestly as `evidenceStrength: none` with zero citations — that's a valid, transparent state, not a hidden one.)*
- ❌ No partisan/ideology labels as verdicts.

These are enforced in code (validation), not just policy. A report that violates any of these fails QA and is not served.

### 1.5 Evaluation (ship/no-ship gates)
| Metric | Gate for public beta |
|---|---|
| Claim-bearing outputs with ≥1 visible citation | ≥ 95% |
| Model-vs-human-QA agreement (sampled) | ≥ 75% |
| Framing cues with attached evidence | 100% (hard) |
| p95 report latency (cache miss) | ≤ 30s |
| Cache hit served | < 1s |

### 1.6 Legal posture
Advisory · transparent · contestable · privacy-minimized. Every report links the public methodology page and offers a "dispute this analysis" action.

---

## 2. System architecture (v1)

```
React web app ──┐
                ├─► Express API (TS) ──► PostgreSQL (source of truth)
Share links ────┘            │
                             ├─► Redis (URL-hash cache + job queue)
                             └─► Worker(s) ──► analysis pipeline
                                                ├─ transcript (YouTube captions / Whisper)
                                                ├─ LLM: claims + framing + issue-frame
                                                ├─ evidence retrieval (Fact Check API)
                                                └─ bridging match (news API + vector store)
```

- **Cache-first:** every input is normalized → hashed → checked. Hit = serve stored report instantly. Miss = enqueue job.
- **Async:** report generation is a queued job; the client polls or subscribes for status.
- **Swappable adapters:** `LLMProvider`, `TranscriptProvider`, `EvidenceProvider`, `PerspectiveProvider` are interfaces. No vendor names leak into core logic.

---

## 3. Data model (PostgreSQL DDL)

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector for perspective matching

-- ---------- enums ----------
CREATE TYPE source_type   AS ENUM ('youtube', 'article', 'transcript');
CREATE TYPE report_status AS ENUM ('queued', 'processing', 'ready', 'failed', 'needs_review');
CREATE TYPE producing_layer AS ENUM ('ai', 'expert', 'community');
CREATE TYPE verifiability  AS ENUM ('verifiable', 'partially_verifiable', 'opinion', 'unverifiable');
CREATE TYPE evidence_strength AS ENUM ('strong', 'moderate', 'weak', 'none');
CREATE TYPE source_tier    AS ENUM ('tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded');

-- ---------- users ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',   -- user | expert | admin
  org_id        UUID,                           -- nullable; institutional workspace
  prefs         JSONB NOT NULL DEFAULT '{}',    -- theme, locale, notifications (batched)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- content items (one row per unique input) ----------
CREATE TABLE content_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash      TEXT UNIQUE NOT NULL,           -- sha256 of normalized input
  source_type   source_type NOT NULL,
  source_url    TEXT,                           -- null for pasted transcript
  title         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',    -- channel, duration, publish date, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_url_hash ON content_items (url_hash);

-- ---------- analysis reports ----------
CREATE TABLE analysis_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id      UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  status          report_status NOT NULL DEFAULT 'queued',
  version         INT NOT NULL DEFAULT 1,
  producing_layer producing_layer NOT NULL DEFAULT 'ai',
  tldr            TEXT,
  issue_frame     JSONB,                         -- spatial coords + label, NOT a verdict
  framing_signals JSONB NOT NULL DEFAULT '[]',   -- [{technique, evidence_span, omission, source_url}]
  context_gaps    JSONB NOT NULL DEFAULT '[]',
  confidence      NUMERIC(3,2),                  -- 0.00–1.00, overall extraction confidence
  share_slug      TEXT UNIQUE,                   -- public shareable URL token
  error           TEXT,                          -- populated when status='failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_content ON analysis_reports (content_id);
CREATE INDEX idx_reports_status  ON analysis_reports (status);

-- ---------- claims (claim ledger rows) ----------
CREATE TABLE claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  claim_text        TEXT NOT NULL,
  transcript_span   TEXT,                        -- where it was said/written
  verifiability     verifiability NOT NULL,
  evidence_strength evidence_strength NOT NULL,
  source_basis      TEXT,                        -- short rationale
  confidence        NUMERIC(3,2),
  ordinal           INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_claims_report ON claims (report_id);

-- ---------- citations (every claim MUST have >=1 before serve) ----------
CREATE TABLE citations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_url    TEXT NOT NULL,
  source_name   TEXT,
  source_tier   source_tier NOT NULL,
  excerpt       TEXT,
  supports      BOOLEAN                          -- true=supports, false=contradicts, null=context
);
CREATE INDEX idx_citations_claim ON citations (claim_id);

-- ---------- bridging perspective links ----------
CREATE TABLE perspective_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  source_name      TEXT,
  source_tier      source_tier NOT NULL,
  issue_frame_label TEXT,
  divergence_score NUMERIC(3,2),                 -- moderate band enforced by selection rule
  dehumanization_score NUMERIC(3,2),             -- below threshold required
  embedding        vector(1536)                  -- topic match
);
CREATE INDEX idx_perspective_report ON perspective_links (report_id);

-- ---------- community flags (technique tagging, inoculation loop) ----------
CREATE TABLE flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  technique     TEXT NOT NULL,                   -- ad_hominem | false_dichotomy | ...
  note          TEXT,
  corroborated  BOOLEAN NOT NULL DEFAULT false,  -- set true if expert review agrees
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id, technique)
);
CREATE INDEX idx_flags_report ON flags (report_id);

-- ---------- expert reviews + dispute flow ----------
CREATE TABLE expert_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  reviewer_id   UUID NOT NULL REFERENCES users(id),
  changelog     JSONB NOT NULL,                  -- what fields changed and why
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  raised_by     UUID REFERENCES users(id),       -- nullable for anonymous public dispute
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',     -- open | reviewing | resolved
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- ---------- saved analyses + private literacy profile ----------
CREATE TABLE saved_reports (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id   UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_id)
);
```

> **As-built note (persistence).** The DDL above is the canonical v1 target. As shipped, the identity-keyed tables diverge deliberately and are tracked in `f-Socials-debt-and-todo.md`: `saved_reports` shipped as **`reader_saved_reports`** keyed on the **Supabase JWT subject (`TEXT`)** rather than `user_id UUID` (migration `006`), and institutional workspaces added the `007` table set on the same subject convention. The legacy `flags.user_id UUID REFERENCES users(id)` FK above is kept as-is and satisfied by **User_Sync** (migration `009` + `Repository.ensureLocalUser`), which ensures a local `users` row keyed to the JWT subject exists before a flag is persisted. Disputes remain anonymous (`raised_by` NULL).

**Invariant enforced before `status = 'ready'`:** every `claims` row has ≥1 `citations` row; every `framing_signals` entry has a non-empty `evidence_span` and `source_url`. Violations → `status = 'needs_review'`.

---

## 4. API routes (v1)

Base: `/api/v1`. Auth via JWT (Google OAuth + email). Public read for shared reports.

### Analysis
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/analyses` | Submit input `{ source_type, url \| transcript }`. Returns `{ report_id, status, cached }`. Cache hit returns `ready` immediately. |
| `GET` | `/analyses/:id` | Poll/fetch a report (status + full payload when ready). |
| `GET` | `/analyses/:id/status` | Lightweight status poll for the loading state. |
| `GET` | `/r/:share_slug` | **Public** read-only shared report (no auth). |

### Engagement
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/analyses/:id/flags` | Tag a framing technique `{ technique, note? }`. |
| `POST` | `/analyses/:id/disputes` | Raise a dispute `{ reason }` (auth optional). |
| `POST` | `/analyses/:id/save` / `DELETE` | Save/unsave to the user's collection. |

### Account
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/google`, `/auth/email` | Login. |
| `GET` | `/me`, `PATCH /me` | Profile + prefs (batched-notification settings). |
| `GET` | `/me/reports` | Saved + history. |
| `GET` | `/me/literacy` | Private literacy profile (opt-in). |

### Expert / admin (role-gated)
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/review/queue` | Items in `needs_review` or with corroborated-flag thresholds / open disputes. |
| `POST` | `/review/:report_id` | Submit review `{ changelog }`, bumps `version`, sets `producing_layer='expert'`. |

**Rate limiting:** anonymous = N analyses/day per IP; authenticated free = higher; institutional = per-seat. 429 with retry hint on exceed.

---

## 5. Analysis-job contract

The worker is a pure pipeline. Input → stages → typed report. Each stage is independently testable and fails loud.

```ts
// Job input (enqueued on cache miss)
interface AnalysisJob {
  reportId: string;
  contentId: string;
  sourceType: 'youtube' | 'article' | 'transcript';
  raw: { url?: string; transcript?: string };
}

// Stage 1: transcript acquisition
interface Transcript { text: string; segments?: { start: number; text: string }[]; lang: string; }

// Stage 2: LLM extraction (deterministic prompt, temperature low)
interface Extraction {
  tldr: string;
  claims: {
    text: string; transcriptSpan: string;
    verifiability: Verifiability; confidence: number;
  }[];
  framingSignals: { technique: string; evidenceSpan: string; omission: string }[];
  issueFrame: { label: string; x: number; y: number };   // spatial, not a verdict
}

// Stage 3: evidence retrieval (per claim)
interface EvidenceResult {
  claimText: string;
  evidenceStrength: EvidenceStrength;
  citations: { url: string; name: string; tier: SourceTier; excerpt: string; supports: boolean | null }[];
}

// Stage 4: bridging perspectives (selection rule from concept §6.5)
interface PerspectiveResult {
  links: { url: string; name: string; tier: SourceTier;
           issueFrameLabel: string; divergence: number; dehumanization: number }[];
}

// Stage 5: assembly + invariant gate
//   - drop any claim with 0 citations -> if any claim dropped & none remain, status=needs_review
//   - drop any framing signal missing evidenceSpan or source
//   - if gates pass -> status=ready, else needs_review
```

**Failure policy:** any stage throwing → `status='failed'`, `error` populated, job retried up to 2x with backoff. Low overall `confidence` (< threshold) → `status='needs_review'` rather than `ready`.

**Determinism:** LLM prompts pinned and versioned; the prompt version is stored so a report can be reproduced/audited.

---

## 6. MVP screen list

| # | Screen | Key elements |
|---|---|---|
| 1 | **Home / Submit** | Single prominent input (URL or paste), example links, one-minute "how to read an analysis" entry point |
| 2 | **Loading** | Honest progress ("transcribing → extracting claims → checking sources"), no fake spinners |
| 3 | **Report** | TLDR · Claim Ledger (expandable cards w/ citations) · Framing & Context Cards (expandable evidence) · Context Gaps · Bridging Sources · provenance footer · share + dispute actions |
| 4 | **Shared report (public)** | Read-only report at `/r/:slug`, no chrome, CTA to try it |
| 5 | **Auth** | Google + email |
| 6 | **My reports** | Saved + history collections |
| 7 | **Literacy profile** | Private, opt-in consumption insight + earned markers |
| 8 | **Methodology** | Public, plain-language: scoring approach, source policy, who reviews, how to dispute |
| 9 | **Review queue** (expert/admin) | Needs-review + disputed items, edit-with-changelog |
| 10 | **Institutional workspace** *(pilots; can stub in Foundation)* | Shared collections, classroom annotation hooks |

**Design constraints (all screens):** dark mode default, cool neutral palette, WCAG 2.2 AA (text labels + color, keyboard nav, screen-reader-friendly charts), framing cards never accusatory without evidence, EN + NL.

---

## 7. Foundation-phase build order

1. Schema + migrations + adapters (interfaces with one concrete provider each).
2. `POST /analyses` + cache + job queue + worker stages 1–2 (transcript + extraction).
3. Worker stages 3–5 (evidence + bridging + invariant gate).
4. Report screen + shared-report public route.
5. Auth + save/history.
6. Methodology page + dispute flow.
7. Expert review queue.
8. The runnable check (see §8) wired into CI.

---

## 8. The one runnable check (non-negotiable) — **implemented**

A single test that fails if the core guarantee breaks: **no claim asserts an evidence strength it cannot cite, no framing signal without evidence.** Run against the assembly stage (`core/assemble.ts`) with fixture reports. Lives at `apps/server/test/invariant.test.ts` and is in the `npm test` suite.

```ts
// invariant.test.ts — the smallest thing that fails if the lens becomes a judge
test('a report is held for review if a claim over-claims its evidence or a framing signal lacks evidence', () => {
  // A claim asserting strength (weak/moderate/strong) with zero citations -> needs_review.
  const assembled = assembleReport(fixtureWithOverclaimedClaim);
  expect(assembled.status).toBe('needs_review');      // NOT 'ready'

  const ok = assembleReport(fixtureFullyCited);
  expect(ok.status).toBe('ready');
  for (const c of ok.claims) {
    // 'none' + zero citations is a VALID honest state; any other strength must cite.
    if (c.evidenceStrength !== 'none') expect(c.citations.length).toBeGreaterThan(0);
  }
  for (const f of ok.framingSignals) {
    expect(f.examples.length).toBeGreaterThan(0);
    for (const e of f.examples) {
      expect(e.text).toBeTruthy();          // the quote that triggered it
      expect(e.explanation).toBeTruthy();   // why it's a framing signal
    }
  }
});
```

If this test ever needs to be weakened to ship a feature, the feature is wrong, not the test.
