-- f-Socials supabase-user-sync — migration 009.
-- Data-preserving + re-runnable: relax users.email to nullable so a Supabase user
-- synced from verified JWT claims that omit an email is storable with email NULL
-- (Req 5.1). DROP NOT NULL is idempotent — a second run is a no-op leaving an
-- identical schema (Req 9.2). Every existing row keeps its non-null email (Req 9.3).
-- The column is neither dropped, renamed, nor retyped, and UNIQUE(email) is left
-- intact — under that index Postgres treats NULLs as distinct, so multiple
-- email-absent users never collide (Req 5.2). No verdict/rating column (compass).
-- Sorts lexically after 008 so the runner applies it last (Req 9.4).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
