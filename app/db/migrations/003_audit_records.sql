-- f-Socials claim-verification-router — migration 003.
-- Persists one Audit_Record per checked claim (6.1). Mirrors the existing
-- JSONB-blob pattern (analysis_reports.data): the full AuditRecord is stored
-- losslessly in `data`, with report_id/claim_id pulled out for indexing.

CREATE TABLE audit_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  claim_id    UUID NOT NULL,
  data        JSONB NOT NULL,           -- the full AuditRecord, lossless
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_report ON audit_records (report_id);
