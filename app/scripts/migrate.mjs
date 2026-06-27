// Apply db/migrations/*.sql to Neon in filename order. Uses the direct
// (unpooled) URL. Run: `node scripts/migrate.mjs`
import { readFileSync, readdirSync } from 'node:fs';
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

const migrationsDir = resolve(here, '../db/migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort(); // lexical order works for the zero-padded NNN_ prefix

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    try {
      await client.query(sql);
      console.log(`✓ migration ${file} applied`);
    } catch (e) {
      if (/already exists/i.test(e.message)) {
        console.log(`• ${file} already present (`, e.message.split('\n')[0], ')');
      } else {
        throw e;
      }
    }
  }
} catch (e) {
  console.error('migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
