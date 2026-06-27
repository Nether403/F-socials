-- f-Socials trust-and-launch-bundle — migration 002.
-- Adds the nullable claim_id column to disputes so a reader can dispute a
-- specific claim (3.8). NULL means the dispute targets the report as a whole.

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS claim_id TEXT;
