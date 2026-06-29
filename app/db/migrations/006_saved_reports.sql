-- f-Socials accounts-save-history — migration 006.
-- Additive: a per-reader saved-report store keyed by the Supabase JWT subject
-- (TEXT), following the identity convention established in migration 005
-- (assigned_reviewer / resolved_by are TEXT subjects, not users(id) FKs).
-- Re-run safe: IF NOT EXISTS on the table and index.
-- Lens, not a judge: no column expresses a creator rating or truthfulness verdict.
CREATE TABLE IF NOT EXISTS reader_saved_reports (
  reader_id  TEXT        NOT NULL,                  -- Supabase auth subject (JWT sub)
  report_id  UUID        NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_id, report_id)                -- enforces at-most-one (Req 7.3, 11.6)
);

-- Reader-scoped, reverse-chronological listing with the deterministic tie-break (Req 9.2).
CREATE INDEX IF NOT EXISTS idx_reader_saved_reports_listing
  ON reader_saved_reports (reader_id, saved_at DESC, report_id DESC);
