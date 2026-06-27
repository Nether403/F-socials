-- f-Socials v1 — initial schema.
-- Applied when you swap the in-memory Repository for Postgres (Supabase/Neon).
-- Mirrors the data model in f-Socials-v1-product-definition.md §3.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector for perspective matching

-- ---------- enums ----------
CREATE TYPE source_type       AS ENUM ('youtube', 'article', 'transcript');
CREATE TYPE report_status     AS ENUM ('queued', 'processing', 'ready', 'failed', 'needs_review');
CREATE TYPE producing_layer   AS ENUM ('ai', 'expert', 'community');
CREATE TYPE verifiability      AS ENUM ('verifiable', 'partially_verifiable', 'opinion', 'unverifiable');
CREATE TYPE evidence_strength  AS ENUM ('strong', 'moderate', 'weak', 'none');
CREATE TYPE source_tier        AS ENUM ('tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded');

-- ---------- users ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  org_id        UUID,
  prefs         JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- content items (one row per unique input) ----------
CREATE TABLE content_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash      TEXT UNIQUE NOT NULL,
  source_type   source_type NOT NULL,
  source_url    TEXT,
  title         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
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
  issue_frame     JSONB,
  framing_signals JSONB NOT NULL DEFAULT '[]',
  context_gaps    JSONB NOT NULL DEFAULT '[]',
  confidence      NUMERIC(3,2),
  share_slug      TEXT UNIQUE,
  error           TEXT,
  -- v1 stores the full report object here (lossless round-trip). The normalized
  -- claims/citations/perspective_links tables are reserved for later analytics
  -- (cross-report queries, channel scorecards) and are not yet populated.
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_content ON analysis_reports (content_id);
CREATE INDEX idx_reports_status  ON analysis_reports (status);

-- ---------- claims ----------
CREATE TABLE claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  claim_text        TEXT NOT NULL,
  transcript_span   TEXT,
  verifiability     verifiability NOT NULL,
  evidence_strength evidence_strength NOT NULL,
  source_basis      TEXT,
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
  supports      BOOLEAN
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
  divergence_score NUMERIC(3,2),
  dehumanization_score NUMERIC(3,2),
  embedding        vector(1536)
);
CREATE INDEX idx_perspective_report ON perspective_links (report_id);

-- ---------- community flags ----------
CREATE TABLE flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  technique     TEXT NOT NULL,
  note          TEXT,
  corroborated  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id, technique)
);
CREATE INDEX idx_flags_report ON flags (report_id);

-- ---------- expert reviews + dispute flow ----------
CREATE TABLE expert_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  reviewer_id   UUID NOT NULL REFERENCES users(id),
  changelog     JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  raised_by     UUID REFERENCES users(id),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- ---------- saved analyses ----------
CREATE TABLE saved_reports (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id   UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_id)
);
