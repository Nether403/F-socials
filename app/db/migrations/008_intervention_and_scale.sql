-- Migration 008: Intervention & Scale — additive tables only (no ALTER/DROP).
-- Sorts lexically after 007_workspaces.sql.

-- Institutional API keys: store a HASH only; plaintext never persisted (Req 6.8).
CREATE TABLE IF NOT EXISTS api_keys (
  id             UUID        PRIMARY KEY,
  institution_id TEXT        NOT NULL,
  key_hash       TEXT        NOT NULL UNIQUE,          -- sha256(plaintext)
  rate_max       INTEGER,                              -- null => default 100 (Req 8.5)
  rate_window_s  INTEGER,                              -- null => default 60; CHECK 1..86400 (Req 8.4)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,                          -- non-null => revoked (Req 6.4)
  CHECK (rate_window_s IS NULL OR (rate_window_s BETWEEN 1 AND 86400))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (institution_id) WHERE revoked_at IS NULL; -- <=10 active (Req 6.7)

-- Per-key fixed-window rate counter (Postgres driver; Redis driver uses its own keyspace).
CREATE TABLE IF NOT EXISTS api_key_rate_windows (
  key_id        UUID        PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0
);

-- Optional runtime trust-gate overrides (env remains the floor/source of truth).
CREATE TABLE IF NOT EXISTS trust_gate_config (
  capability        TEXT PRIMARY KEY CHECK (capability IN ('feed_friction','institutional_api','coaching')),
  coverage_min      DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (coverage_min BETWEEN 0 AND 1),
  agreement_min     DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (agreement_min BETWEEN 0 AND 1),
  legal_review_ok   BOOLEAN          NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT now()
);
