-- f-Socials report-graph-normalization — migration 004.
-- Activates the reserved claims/citations/perspective_links tables for the
-- dual-write. Additive only: preserves analysis_reports + its JSONB consumers.

-- Stable traceback from a normalized claim row to its Claim in the JSONB payload.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_uid TEXT;

-- Idempotent replace works by delete-by-report_id; this unique guard also makes
-- (report_id, claim_uid) a natural key and supports cross-report claim grouping.
CREATE UNIQUE INDEX IF NOT EXISTS uq_claims_report_claimuid
  ON claims (report_id, claim_uid);

-- Cross-report queryability (Req 11): group/count claims by source and by claim.
CREATE INDEX IF NOT EXISTS idx_citations_source_url    ON citations (source_url);
CREATE INDEX IF NOT EXISTS idx_citations_source_tier   ON citations (source_tier);
CREATE INDEX IF NOT EXISTS idx_claims_claim_text       ON claims (claim_text);
CREATE INDEX IF NOT EXISTS idx_perspective_source_tier ON perspective_links (source_tier);
