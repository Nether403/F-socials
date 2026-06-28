// Composition root entry: build the shared context and mount HTTP (API_Server).
// The worker runs in its own process (worker.ts) in the deployed configuration;
// for local dev RUN_WORKER_IN_PROCESS (default true in dev) runs it in-process here.

import express from 'express';
import { config, missingRequiredConfig } from './config';
import { buildContext } from './compose';
import { makeWorker } from './pipeline/worker';
import { makeRouter } from './http/routes';
import { optionalAuth } from './http/auth';

const { repo, cache, queue, limiter, telemetry, providers, meta } = buildContext();

// --- worker consumes the queue in-process only in dev (deployed runs worker.ts separately) ---
if (config.runWorkerInProcess) {
  console.log('[worker] running in-process (RUN_WORKER_IN_PROCESS); deployed configuration runs worker.ts separately');
  queue.process(
    makeWorker({
      repo,
      cache,
      telemetry,
      providers,
      meta,
    }),
  );
}

// --- HTTP ---
const app = express();
app.set('trust proxy', 1); // honor X-Forwarded-For from the hosting proxy (Railway/Vercel)

// Minimal CORS, only when CORS_ORIGIN is set (prod). Dev uses the Vite proxy, no CORS needed.
if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1', optionalAuth, makeRouter({ repo, cache, queue, limiter, telemetry }));

// Basic error handler (Express 5 forwards async rejections here).
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  // Observe only: capture once for the Error_Monitor (no PII — method + route only, no ids/tokens/body).
  // Status/body returned to the client are unchanged by this call (Req 4.1, 4.8).
  telemetry.capture(err, { source: 'express_error_handler', method: req.method, path: req.path });
  res.status(500).json({ error: 'internal_error' });
});

// --- startup validation (5.11) + degraded access-control warnings (5.12) ---
// Mode mirrors config.ts's isDeployed (NODE_ENV==='production'); dev gates nothing.
const mode = process.env.NODE_ENV === 'production' ? 'deployed' : 'dev';
const missing = missingRequiredConfig(process.env, mode);
if (missing.length > 0) {
  for (const name of missing) {
    console.error(`[startup] missing required configuration: ${name}`);
  }
  process.exit(1); // exit before binding the port (5.11)
}

// Access controls degrade with a warning instead of blocking startup (5.12).
// Protected routes still mount requireAuth and fail closed by design (5.5).
if (mode === 'deployed') {
  if (!config.supabase.jwtSecret) {
    console.warn('[startup] requireAuth not configured (SUPABASE_JWT_SECRET empty) — protected routes will fail closed (reject all)');
  }
  if (!limiter) {
    console.warn('[startup] Rate_Limiter did not activate — new analyses are not rate limited');
  }
}

app.listen(config.port, () => {
  console.log(`f-Socials server listening on http://localhost:${config.port}`);
  console.log(`LLM_PROVIDER=${config.llmProvider} | transcript=router(youtube+paste) | evidence=${config.evidenceProvider} | perspective=${config.perspectiveProvider}`);
});
