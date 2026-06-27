// Feature: trust-and-launch-bundle, degraded access controls (Validates: 5.12)
//
// Access controls degrade with a warning instead of blocking startup: starting
// the deployed server without SUPABASE_JWT_SECRET must still bind the port and
// log a warning naming requireAuth (protected routes then fail closed by design).
//
// Approach: spawn the real entrypoint (src/index.ts via tsx) in deployed mode
// with all required config present but SUPABASE_JWT_SECRET empty, then assert we
// see both the requireAuth warning AND the "listening" line (the server did not
// exit). We pass SUPABASE_JWT_SECRET='' explicitly because env.ts lets real env
// vars win over the .env file only when they are *defined* — an empty string
// beats the .env's real secret and reproduces the absent condition.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/server

test('deployed startup without SUPABASE_JWT_SECRET warns about requireAuth and still starts', { timeout: 60_000 }, async (t) => {
  let child: ChildProcessWithoutNullStreams | undefined;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production', // deployed mode gates required config + enables degrade warnings
        REPO_DRIVER: 'memory', // memory drivers => no DATABASE_URL / REDIS_URL required, no external connections
        CACHE_DRIVER: 'memory',
        QUEUE_DRIVER: 'memory',
        RUN_WORKER_IN_PROCESS: 'false',
        CORS_ORIGIN: 'http://example.test', // deployed requires CORS_ORIGIN
        PORT: '4744', // uncommon port to avoid clashes
        SUPABASE_JWT_SECRET: '', // the control under test: empty => requireAuth cannot activate
        // keep providers offline so nothing reaches out at startup
        LLM_PROVIDER: 'mock',
        EVIDENCE_PROVIDER: 'mock',
        PERSPECTIVE_PROVIDER: 'mock',
      },
    });
  } catch (err) {
    t.skip(`could not spawn child process: ${(err as Error).message}`);
    return;
  }

  let output = '';
  let sawWarning = false;
  let sawListening = false;

  const done = new Promise<void>((resolveDone, rejectDone) => {
    const onData = (buf: Buffer) => {
      output += buf.toString();
      if (/requireAuth/.test(output)) sawWarning = true;
      if (/listening/i.test(output)) sawListening = true;
      if (sawWarning && sawListening) resolveDone();
    };
    child!.stdout.on('data', onData);
    child!.stderr.on('data', onData); // console.warn writes to stderr
    child!.on('error', rejectDone);
    child!.on('exit', (code) => {
      // Reaching the listening line means success even if the test then kills it.
      if (sawWarning && sawListening) return;
      rejectDone(new Error(`server exited (code ${code}) before both signals were seen.\n--- output ---\n${output}`));
    });
  });

  try {
    await done;
    assert.ok(sawWarning, `expected a startup warning naming requireAuth. Output:\n${output}`);
    assert.ok(sawListening, `expected the server to bind and log a listening line. Output:\n${output}`);
  } finally {
    child.kill(); // always free the port / terminate the spawned server
  }
});
