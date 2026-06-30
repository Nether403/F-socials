// Feature: supabase-user-sync, Property 9: Driver parity
// Validates: Requirements 7.2
//
// For any identical sequence of ensureLocalUser inputs applied to the
// InMemoryRepository (the model) and the PostgresRepository, both drivers yield
// EQUIVALENT observable Local_User state: exactly one row per subject, the same
// stored email and role, and a created_at that is preserved across repeat syncs.
// This file also carries the Postgres concurrent-convergence leg for Property 3
// (Req 2.6) — N concurrent ensureLocalUser calls for one subject settle to a
// single row with no race error.
//
// This is a Postgres integration test: it needs a real database. Without
// TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly (node:test skip), so the
// offline-first suite stays green with zero API keys / no database. Point it at
// a throwaway DB via TEST_DATABASE_URL (preferred) or DATABASE_URL. When a DB is
// present it applies migrations 001..009 (tolerating "already exists"), then runs
// 100 generated input-sequences, each against a fresh InMemoryRepository and the
// shared PostgresRepository, asserting the synced Local_User agrees per subject.
//
// Comparing created_at across drivers, deterministically. The in-memory repo
// stamps created_at from `new Date().toISOString()` and Postgres from the column
// default `now()`, so the two ABSOLUTE values differ by construction and are
// intentionally never compared across drivers. What Property 9 actually asserts
// about created_at is that each driver PRESERVES it across repeat syncs — so we
// capture each driver's created_at after the sequence, run one more idempotent
// ensureLocalUser per subject, and assert the value is unchanged within that
// same driver.
//
// Email uniqueness across subjects. The real `users` table keeps UNIQUE(email).
// Two DISTINCT subjects presenting the SAME non-null email would make the second
// Postgres upsert reject (the documented ponytail ceiling). Supabase enforces a
// unique email per subject, so to model only the in-practice input space the
// generated email — when present — embeds the run id and the subject index, so
// distinct subjects never share an email while a single subject can still change
// its email across calls (exercising the claim-merge update path). An absent
// email (undefined) models the no-email claim (Req 5.1) and is non-colliding in
// both drivers (map keyed by id only / NULLs distinct under the unique index).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import type { Pool } from 'pg';

import { InMemoryRepository } from '../src/infra/memory';
import { PostgresRepository, makePgPool } from '../src/infra/postgres';
import type { LocalUser } from '../src/infra/ports';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = DB_URL
  ? false
  : 'no TEST_DATABASE_URL/DATABASE_URL — skipping Postgres integration test';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// Apply every db/migrations/*.sql in lexical order (001..009), tolerating the
// "already exists" / "already" no-op errors a reused test DB raises — mirrors
// scripts/migrate.mjs. Migration 009 (DROP NOT NULL on users.email) is required
// here so an email-absent synced user is storable.
async function applyMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
    }
  }
}

const SUBJECT_COUNT = 3;
const ROLES = ['user', 'admin', 'moderator', 'editor'] as const;

// A generated sync op: picks one of SUBJECT_COUNT subjects and an optional
// email/role claim. Drawing subjects from a small pool makes the same subject
// frequently re-synced — the case that exercises the idempotent-merge path and
// would catch a created_at reset or a claim-merge divergence between drivers.
const opsArb = fc.array(
  fc.record({
    subjectIdx: fc.integer({ min: 0, max: SUBJECT_COUNT - 1 }),
    // emailSeed: -1 ⇒ absent (no-email claim); >=0 ⇒ a present, per-subject email.
    emailSeed: fc.integer({ min: -1, max: 3 }),
    role: fc.option(fc.constantFrom(...ROLES), { nil: undefined }),
  }),
  { minLength: 1, maxLength: 15 },
);

test('Property 9: in-memory and Postgres ensureLocalUser agree on synced Local_User state', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const pg = new PostgresRepository(pool);

  try {
    await applyMigrations(pool);

    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        // Run-scoped subject UUIDs so concurrent/sequential runs never collide and
        // cleanup is exact (these are the only users rows this run inserts).
        const runId = randomUUID();
        const subjects = Array.from({ length: SUBJECT_COUNT }, () => randomUUID());
        const mem = new InMemoryRepository();

        // Per-subject email is unique across subjects (embeds the subject UUID),
        // so distinct subjects never trip UNIQUE(email); a single subject can vary
        // its email seed to exercise the update path.
        const emailFor = (subjectIdx: number, seed: number): string | undefined =>
          seed < 0 ? undefined : `usync-${subjects[subjectIdx]}-${seed}@example.com`;

        const touched = new Set<number>();

        try {
          // Identical op-sequence against BOTH repositories, in the same order.
          for (const op of ops) {
            const id = subjects[op.subjectIdx]!;
            const email = emailFor(op.subjectIdx, op.emailSeed);
            const claim: { id: string; email?: string; role?: string } = { id };
            if (email !== undefined) claim.email = email;
            if (op.role !== undefined) claim.role = op.role;

            await mem.ensureLocalUser(claim);
            await pg.ensureLocalUser(claim);
            touched.add(op.subjectIdx);
          }

          // Every touched subject must resolve to a Local_User in BOTH drivers,
          // agreeing on id, email and role (one row per subject, Req 7.2).
          const memCreatedAt = new Map<number, string>();
          const pgCreatedAt = new Map<number, string>();
          for (const subjectIdx of touched) {
            const id = subjects[subjectIdx]!;
            const m = (await mem.getLocalUser(id)) as LocalUser | undefined;
            const p = (await pg.getLocalUser(id)) as LocalUser | undefined;

            assert.ok(m, `in-memory missing synced user for subject ${id}`);
            assert.ok(p, `Postgres missing synced user for subject ${id}`);
            assert.equal(p!.id, m!.id, 'synced id disagrees');
            assert.equal(p!.id, id, 'synced id is not the subject');
            assert.equal(p!.email, m!.email, 'synced email disagrees across drivers');
            assert.equal(p!.role, m!.role, 'synced role disagrees across drivers');

            memCreatedAt.set(subjectIdx, m!.createdAt);
            pgCreatedAt.set(subjectIdx, p!.createdAt);
          }

          // created_at preserved across a repeat sync — within each driver (the two
          // drivers' absolute values differ by construction and are not compared).
          for (const subjectIdx of touched) {
            const id = subjects[subjectIdx]!;
            await mem.ensureLocalUser({ id });
            await pg.ensureLocalUser({ id });

            const m = (await mem.getLocalUser(id)) as LocalUser;
            const p = (await pg.getLocalUser(id)) as LocalUser;
            assert.equal(m.createdAt, memCreatedAt.get(subjectIdx), 'in-memory created_at changed on repeat');
            assert.equal(p.createdAt, pgCreatedAt.get(subjectIdx), 'Postgres created_at changed on repeat');
            // The omitting repeat retains the prior email/role in both (Req 2.5).
            assert.equal(p.email, m.email, 'synced email diverged after omitting repeat');
            assert.equal(p.role, m.role, 'synced role diverged after omitting repeat');
          }
        } finally {
          // Drop only this run's inserted users rows (run-unique subject UUIDs →
          // exact scope; never touches pre-existing data).
          await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [subjects]).catch(() => {});
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    await pool.end();
  }
});

// Property 3 (Req 2.6), Postgres leg: concurrent convergence. N ensureLocalUser
// calls for ONE subject fired concurrently against Postgres all settle without a
// race error and leave exactly one row (id is the PK / ON CONFLICT (id) target).
test('Property 3 (Postgres leg): concurrent ensureLocalUser for one subject converges to a single row', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const pg = new PostgresRepository(pool);
  const subject = randomUUID();
  const N = 8;

  try {
    await applyMigrations(pool);

    // Fire N concurrent syncs for the same subject with varying role claims.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        pg.ensureLocalUser({ id: subject, email: `usync-conc-${subject}@example.com`, role: ROLES[i % ROLES.length] }),
      ),
    );

    const r = await pool.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [subject]);
    assert.equal(r.rows[0].n, 1, 'concurrent syncs must converge to exactly one users row');

    const u = await pg.getLocalUser(subject);
    assert.ok(u, 'the single converged row must be readable');
    assert.equal(u!.id, subject);
  } finally {
    await pool.query(`DELETE FROM users WHERE id = $1`, [subject]).catch(() => {});
    await pool.end();
  }
});
