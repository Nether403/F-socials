-- f-Socials expert-review-queue — migration 005.
-- Additive review-workflow state on the existing disputes + flags tables, so a
-- way exists to triage, claim, assign, and resolve incoming disputes and flags.
-- Additive only: preserves every existing disputes/flags row and the intake
-- route contracts (Req 7.3). New columns default to 'pending', so existing rows
-- become pending Review_Items with no backfill statement needed (Req 7.5).
-- Re-run safe: enum creation is guarded against duplicate_object and every
-- column/index uses IF NOT EXISTS, so a second apply is a no-op (Req 7.6).
-- Lens, not a judge: no column or enumerated value here expresses a
-- creator-reliability rating or a truthfulness verdict (Req 7.4, 9.1).

-- ---------- enum types (re-run-safe guards; CREATE TYPE has no IF NOT EXISTS) ----------
DO $$ BEGIN
  CREATE TYPE review_status_kind AS ENUM ('pending', 'in_review', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE resolution_outcome AS ENUM (
    'framing_example_confirmed', 'framing_example_weak',
    'evidence_adequately_cited', 'evidence_overstated',
    'context_gap_noted', 'no_change_needed', 'needs_further_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- disputes: six additive review columns ----------
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS review_status      review_status_kind NOT NULL DEFAULT 'pending';
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_reviewer  TEXT;            -- NULL = unassigned
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution_outcome resolution_outcome;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution_note    TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_by        TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ;     -- distinct from legacy resolved_at

-- ---------- flags: the same six additive review columns ----------
ALTER TABLE flags ADD COLUMN IF NOT EXISTS review_status      review_status_kind NOT NULL DEFAULT 'pending';
ALTER TABLE flags ADD COLUMN IF NOT EXISTS assigned_reviewer  TEXT;
ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolution_outcome resolution_outcome;
ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolution_note    TEXT;
ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolved_by        TEXT;
ALTER TABLE flags ADD COLUMN IF NOT EXISTS review_resolved_at TIMESTAMPTZ;

-- ---------- indexes for the queue list + per-report derivation ----------
CREATE INDEX IF NOT EXISTS idx_disputes_review_status ON disputes (review_status);
CREATE INDEX IF NOT EXISTS idx_flags_review_status    ON flags (review_status);
CREATE INDEX IF NOT EXISTS idx_disputes_report        ON disputes (report_id);

-- Legacy disputes.status ('open'), disputes.resolution, and disputes.resolved_at
-- are intentionally left untouched; the workflow uses the new review_status /
-- resolution_* / review_resolved_at columns to avoid colliding with them.
