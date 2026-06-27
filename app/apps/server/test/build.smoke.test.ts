// Feature: trust-and-launch-bundle, build smoke (Validates: 5.1, 5.2, 5.10)
//
// Environment-heavy, slow end-to-end check of the production build pipeline. It is
// intentionally NOT in package.json's `test` script (the fast unit run) — run it
// directly with:  node --import tsx --test test/build.smoke.test.ts
//
// What it proves, against the real toolchain (not mocks):
//   5.1  `npm run build` emits dist/index.js + dist/worker.js, and both start under
//        plain `node` with NO tsx loader.
//   5.10 The API (index.ts) and the Worker (worker.ts) are independently runnable
//        long-running processes — the deployed split topology actually boots.
//   5.2  The type gate (`tsc --noEmit`, the first half of `build`) exits non-zero and
//        reports the offending error when a source file has a deliberate type error.
//
// Robustness: if the environment cannot spawn a child node process at all, the
// process tests skip with a clear reason rather than hard-failing. Everything is
// given generous timeouts and every spawned process is killed after it confirms
// startup; the type-error fixture is removed even if assertions throw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(serverDir, 'dist', 'index.js');
const distWorker = join(serverDir, 'dist', 'worker.js');

// Dev/memory configuration: no NODE_ENV=production (so missingRequiredConfig never
// exits), in-memory drivers (no DB/Redis needed), worker disabled in the API process,
// and an uncommon port so the smoke test never collides with a running dev server.
const childEnv = {
  ...process.env,
  NODE_ENV: 'development',
  REPO_DRIVER: 'memory',
  CACHE_DRIVER: 'memory',
  QUEUE_DRIVER: 'memory',
  RUN_WORKER_IN_PROCESS: 'false',
  PORT: '4733',
};

const BUILD_TIMEOUT = 180_000;
const BOOT_TIMEOUT = 45_000;

// Spawn `node <args>` and resolve once `needle` appears in its combined output, or
// when it exits, or after timeoutMs. Always kills the child. Rejects only if the
// process cannot be spawned at all (used to skip gracefully).
function bootAndAwait(
  args: string[],
  needle: string,
  timeoutMs: number,
): Promise<{ found: boolean; output: string; exitCode: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: serverDir, env: childEnv });
    } catch (err) {
      rejectPromise(err);
      return;
    }

    let output = '';
    let settled = false;
    const finish = (found: boolean, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolvePromise({ found, output, exitCode });
    };

    const onData = (buf: Buffer) => {
      output += buf.toString();
      if (output.includes(needle)) finish(true, null);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(err);
      }
    });
    child.on('exit', (code) => finish(output.includes(needle), code));

    const timer = setTimeout(() => finish(output.includes(needle), null), timeoutMs);
  });
}

test('5.1/5.2: `npm run build` succeeds and emits runnable dist entrypoints', () => {
  const result = spawnSync('npm run build', {
    cwd: serverDir,
    shell: true,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT,
  });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `build should succeed; output:\n${combined}`);
  assert.ok(existsSync(distIndex), 'dist/index.js should be produced by the build');
  assert.ok(existsSync(distWorker), 'dist/worker.js should be produced by the build');
});

test('5.1/5.10: node dist/index.js starts the API without tsx', async (t) => {
  if (!existsSync(distIndex)) {
    t.skip('dist/index.js not present (build step did not produce it)');
    return;
  }
  let res;
  try {
    res = await bootAndAwait(['dist/index.js'], 'f-Socials server listening', BOOT_TIMEOUT);
  } catch (err) {
    t.skip(`cannot spawn a node child process in this environment: ${String(err)}`);
    return;
  }
  // A module-resolution failure / crash would exit non-zero before the listen log.
  assert.ok(
    res.found,
    `API should log its listening line without crashing; got exit=${res.exitCode}, output:\n${res.output}`,
  );
});

test('5.1/5.10: node dist/worker.js starts the worker without tsx', async (t) => {
  if (!existsSync(distWorker)) {
    t.skip('dist/worker.js not present (build step did not produce it)');
    return;
  }
  let res;
  try {
    res = await bootAndAwait(['dist/worker.js'], 'f-Socials worker started', BOOT_TIMEOUT);
  } catch (err) {
    t.skip(`cannot spawn a node child process in this environment: ${String(err)}`);
    return;
  }
  assert.ok(
    res.found,
    `Worker should log its startup line without crashing; got exit=${res.exitCode}, output:\n${res.output}`,
  );
});

test('5.2: the type gate (tsc --noEmit) fails and reports a source type error', () => {
  const fixtureName = '__build_smoke_typeerror__.ts';
  const fixturePath = join(serverDir, 'src', fixtureName);
  // Clean any leftover from a previous interrupted run before writing.
  if (existsSync(fixturePath)) rmSync(fixturePath);
  writeFileSync(
    fixturePath,
    '// temporary fixture for build.smoke.test.ts — deliberate type error\n' +
      'export const brokenOnPurpose: number = "definitely not a number";\n',
  );
  try {
    const result = spawnSync('npm run typecheck', {
      cwd: serverDir,
      shell: true,
      encoding: 'utf8',
      timeout: BUILD_TIMEOUT,
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0, 'tsc --noEmit must exit non-zero on a type error');
    assert.match(combined, /error TS\d+/, 'tsc must report the TypeScript error code');
    assert.match(
      combined,
      /__build_smoke_typeerror__/,
      'tsc must name the offending file in its report',
    );
  } finally {
    // Always remove the fixture, even if the assertions above threw.
    if (existsSync(fixturePath)) rmSync(fixturePath);
  }
});
