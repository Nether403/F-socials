// Apply db/migrations/001_init.sql to Neon. Uses the direct (unpooled) URL.
// Run once: `node scripts/migrate.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(here, '../apps/server/.env'));

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL(_UNPOOLED) in .env');
  process.exit(1);
}

const sql = readFileSync(resolve(here, '../db/migrations/001_init.sql'), 'utf8');
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query(sql);
  console.log('✓ migration 001_init.sql applied');
} catch (e) {
  if (/already exists/i.test(e.message)) {
    console.log('• schema already present (', e.message.split('\n')[0], ')');
  } else {
    console.error('migration failed:', e.message);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
