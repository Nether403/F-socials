// Load .env before anything reads process.env. Imported first by config.ts.
//
// Searches a few likely locations and loads the first that exists, so it works
// whether .env sits next to the server, at the app root, or at the repo root
// (the user keeps theirs at the repo root: h:/f-Socials/.env).
//
// Semantics: real environment variables WIN over the file. That lets you override
// any value at run time (e.g. LLM_PROVIDER=gemini npm run dev) without editing .env.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // .../apps/server/src
const candidates = [
  resolve(here, '../.env'),           // apps/server/.env
  resolve(here, '../../../.env'),     // app/.env
  resolve(here, '../../../../.env'),  // repo root (h:/f-Socials/.env)
];

const presetEnv = { ...process.env };

for (const path of candidates) {
  if (!existsSync(path)) continue;
  try {
    process.loadEnvFile(path);
    // restore anything that was already set in the real environment (env wins)
    for (const [key, value] of Object.entries(presetEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
    console.log(`[env] loaded ${path}`);
  } catch (err) {
    console.warn(`[env] failed to load ${path}:`, err);
  }
  break;
}
