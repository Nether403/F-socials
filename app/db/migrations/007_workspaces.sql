-- f-Socials institutional-workspace — migration 007.
-- Additive: shared workspaces (collections + classroom annotation) keyed by the
-- Supabase JWT subject (TEXT), following the identity convention of migration 006
-- (reader_saved_reports.reader_id). Re-run safe: IF NOT EXISTS throughout.
-- Lens, not a judge: no column expresses a creator rating or truthfulness verdict;
-- an annotation is a reader-authored note only.

CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID        PRIMARY KEY,
  name       TEXT        NOT NULL,
  owner_id   TEXT        NOT NULL,                 -- Supabase auth subject (JWT sub)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  reader_id    TEXT        NOT NULL,               -- Supabase auth subject (JWT sub)
  role         TEXT        NOT NULL CHECK (role IN ('owner','member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, reader_id)            -- at-most-one Membership (Req 2.5)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_reader
  ON workspace_members (reader_id);               -- reader's workspace list (Req 4.1)

CREATE TABLE IF NOT EXISTS workspace_invites (
  code         TEXT        PRIMARY KEY,            -- opaque redeemable token
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_collections (
  id           UUID        PRIMARY KEY,
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shared_collections_workspace
  ON shared_collections (workspace_id);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id UUID        NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  report_id     UUID        NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, report_id)           -- at-most-one item (Req 6.2, 9.7)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_listing
  ON collection_items (collection_id, added_at DESC, report_id DESC); -- Req 6.4

CREATE TABLE IF NOT EXISTS annotations (
  id           UUID        PRIMARY KEY,
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  report_id    UUID        NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  author_id    TEXT        NOT NULL,               -- Supabase auth subject (JWT sub)
  text         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annotations_listing
  ON annotations (workspace_id, report_id, created_at DESC, id DESC); -- Req 7.2
