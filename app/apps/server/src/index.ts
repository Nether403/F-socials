// Composition root: wire infra + providers + worker + HTTP, then listen.
// Swap any in-memory infra or mock provider here when you move to real services.

import express from 'express';
import { config } from './config';
import { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } from './infra/memory';
import { PostgresRepository, makePgPool } from './infra/postgres';
import { RedisCache, RedisQueue, RedisRateLimiter, makeRedisConnection } from './infra/redis';
import type { Cache, Queue, RateLimiter, Repository } from './infra/ports';
import { makeWorker } from './pipeline/worker';
import { makeRouter } from './http/routes';
import { optionalAuth } from './http/auth';
import type { EvidenceProvider, LLMProvider, PerspectiveProvider, Providers } from './providers/types';
import { mockEvidence, mockLLM, mockPerspective } from './providers/mock';
import { makeGeminiLLM } from './providers/gemini';
import { makeGoogleFactCheckEvidence } from './providers/googleFactCheck';
import { makeTavilyEvidence } from './providers/tavily';
import { makeGdeltEvidence } from './providers/gdelt';
import { chainEvidence } from './providers/chain';
import { makeYouTubeTranscript } from './providers/youtube';
import { makeSupadataTranscript } from './providers/supadata';
import { makeFirecrawlArticle } from './providers/firecrawl';
import { makeTranscriptRouter } from './providers/transcriptRouter';
import { makeBridgingPerspective } from './providers/perspective';

// --- infra selection (REPO_DRIVER / CACHE_DRIVER / QUEUE_DRIVER in .env) ---
function selectRepo(): Repository {
  if (config.repoDriver === 'postgres' && config.databaseUrl) {
    console.log('[infra] Repository: Postgres (Neon)');
    return new PostgresRepository(makePgPool(config.databaseUrl));
  }
  if (config.repoDriver === 'postgres') {
    console.warn('[infra] REPO_DRIVER=postgres but DATABASE_URL empty — using in-memory.');
  }
  console.log('[infra] Repository: in-memory');
  return new InMemoryRepository();
}

function selectCache(): Cache {
  if (config.cacheDriver === 'upstash' && config.redisUrl) {
    console.log('[infra] Cache: Upstash Redis');
    return new RedisCache(makeRedisConnection(config.redisUrl));
  }
  console.log('[infra] Cache: in-memory');
  return new InMemoryCache();
}

function selectRateLimiter(): RateLimiter {
  if (config.cacheDriver === 'upstash' && config.redisUrl) {
    console.log(`[infra] RateLimiter: Upstash Redis (${config.rateLimitAnonPerDay}/day)`);
    return new RedisRateLimiter(makeRedisConnection(config.redisUrl), config.rateLimitAnonPerDay);
  }
  console.log(`[infra] RateLimiter: in-memory (${config.rateLimitAnonPerDay}/day)`);
  return new InMemoryRateLimiter(config.rateLimitAnonPerDay);
}

function selectQueue(): Queue {
  if (config.queueDriver === 'upstash' && config.redisUrl) {
    console.log('[infra] Queue: BullMQ (Upstash Redis)');
    return new RedisQueue(config.redisUrl);
  }
  console.log('[infra] Queue: in-memory');
  return new InMemoryQueue();
}

const repo = selectRepo();
const cache = selectCache();
const queue = selectQueue();
const limiter = selectRateLimiter();

// --- LLM provider selection (LLM_PROVIDER in .env) ---
function selectLLM(): LLMProvider {
  if (config.llmProvider === 'gemini') {
    if (!config.gemini.apiKey) {
      console.warn('[providers] LLM_PROVIDER=gemini but GEMINI_API_KEY is empty — falling back to mock.');
      return mockLLM;
    }
    console.log(`[providers] LLM: Gemini (${config.gemini.model}` +
      (config.gemini.backupModel ? ` → backup ${config.gemini.backupModel})` : ')'));
    return makeGeminiLLM({
      apiKey: config.gemini.apiKey,
      model: config.gemini.model,
      backupModel: config.gemini.backupModel || undefined,
    });
  }
  console.log('[providers] LLM: mock');
  return mockLLM;
}

// --- Evidence provider selection (EVIDENCE_PROVIDER in .env) ---
// 'chain' = Google Fact Check → Tavily (authoritative first, broad retrieval as fallback).
// GDELT can be inserted into this chain later. Single-provider values also supported.
function selectEvidence(): EvidenceProvider {
  const which = config.evidenceProvider;
  if (which === 'mock') {
    console.log('[providers] Evidence: mock');
    return mockEvidence;
  }

  const chain: EvidenceProvider[] = [];
  if ((which === 'chain' || which === 'google_factcheck') && config.factCheck.apiKey) {
    chain.push(makeGoogleFactCheckEvidence({ apiKey: config.factCheck.apiKey }));
  }
  // GDELT (keyless) — global news, between authoritative fact-checks and broad retrieval.
  if (which === 'chain' || which === 'gdelt') {
    chain.push(makeGdeltEvidence());
  }
  if ((which === 'chain' || which === 'tavily') && config.tavily.apiKey) {
    chain.push(makeTavilyEvidence({ apiKey: config.tavily.apiKey }));
  }

  if (chain.length === 0) {
    console.warn(`[providers] EVIDENCE_PROVIDER=${which} but no usable API keys — falling back to mock.`);
    return mockEvidence;
  }
  console.log(`[providers] Evidence: ${which} (${chain.length} source${chain.length > 1 ? 's' : ''})`);
  return chain.length === 1 ? chain[0]! : chainEvidence(chain);
}

// --- transcript: YouTube via Supadata if configured, else watch-page (which will
// error helpfully since YouTube blocks server-side caption fetch). Paste always works. ---
const youtubeTranscript = config.supadata.apiKey
  ? makeSupadataTranscript({ apiKey: config.supadata.apiKey })
  : makeYouTubeTranscript();
const articleTranscript = config.firecrawl.apiKey
  ? makeFirecrawlArticle({ apiKey: config.firecrawl.apiKey })
  : undefined;
console.log(
  `[providers] Transcript: paste + YouTube via ${config.supadata.apiKey ? 'Supadata' : 'watch-page'}` +
    ` + article via ${config.firecrawl.apiKey ? 'Firecrawl' : '(not configured)'}`,
);

// --- Perspective provider selection (PERSPECTIVE_PROVIDER in .env) ---
function selectPerspective(): PerspectiveProvider {
  if (config.perspectiveProvider === 'bridging') {
    if (!config.tavily.apiKey || !config.gemini.apiKey) {
      console.warn('[providers] PERSPECTIVE_PROVIDER=bridging needs TAVILY_API_KEY + GEMINI_API_KEY — falling back to mock.');
      return mockPerspective;
    }
    console.log('[providers] Perspective: bridging (Tavily + Gemini)');
    return makeBridgingPerspective({
      tavilyApiKey: config.tavily.apiKey,
      gemini: {
        apiKey: config.gemini.apiKey,
        model: config.gemini.model,
        backupModel: config.gemini.backupModel || undefined,
      },
    });
  }
  console.log('[providers] Perspective: mock');
  return mockPerspective;
}

// --- providers (swap mocks for real services later) ---
const providers: Providers = {
  transcript: makeTranscriptRouter({ youtube: youtubeTranscript, article: articleTranscript }),
  llm: selectLLM(),
  evidence: selectEvidence(),
  perspective: selectPerspective(),
};

// --- worker consumes the queue ---
queue.process(
  makeWorker({
    repo,
    cache,
    providers,
    meta: {
      model: config.llmProvider === 'gemini' ? config.gemini.model : 'mock',
      analysisVersion: '1.0.0',
      sourcePolicyVersion: 'v1',
    },
  }),
);

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
app.use('/api/v1', optionalAuth, makeRouter({ repo, cache, queue, limiter }));

// Basic error handler (Express 5 forwards async rejections here).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, () => {
  console.log(`f-Socials server listening on http://localhost:${config.port}`);
  console.log(`LLM_PROVIDER=${config.llmProvider} | transcript=router(youtube+paste) | evidence=${config.evidenceProvider} | perspective=${config.perspectiveProvider}`);
});
