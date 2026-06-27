// Shared composition root: select infra drivers + providers, build the worker
// context. Both the API entrypoint (index.ts) and the worker entrypoint import
// buildContext() so they wire identical infra/providers.
// Swap any in-memory infra or mock provider here when you move to real services.

import { config } from './config';
import { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } from './infra/memory';
import { PostgresRepository, makePgPool } from './infra/postgres';
import { RedisCache, RedisQueue, RedisRateLimiter, makeRedisConnection } from './infra/redis';
import type { Cache, Queue, RateLimiter, Repository } from './infra/ports';
import type { EvidenceProvider, LLMProvider, PerspectiveProvider, Providers } from './providers/types';
import { mockEvidence, mockLLM, mockNormalizer, mockPerspective, mockValidator } from './providers/mock';
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
import { SOURCE_POLICY_VERSION } from './core/sourceTier';

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

export interface WorkerMeta {
  model: string;
  analysisVersion: string;
  sourcePolicyVersion: string;
}

export interface AppContext {
  repo: Repository;
  cache: Cache;
  queue: Queue;
  limiter: RateLimiter;
  providers: Providers;
  meta: WorkerMeta;
}

export function buildContext(): AppContext {
  const repo = selectRepo();
  const cache = selectCache();
  const queue = selectQueue();
  const limiter = selectRateLimiter();

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

  // --- providers (swap mocks for real services later) ---
  const providers: Providers = {
    transcript: makeTranscriptRouter({ youtube: youtubeTranscript, article: articleTranscript }),
    llm: selectLLM(),
    evidence: selectEvidence(),
    perspective: selectPerspective(),
    normalizer: mockNormalizer,
    validator: mockValidator,
  };

  const meta: WorkerMeta = {
    model: config.llmProvider === 'gemini' ? config.gemini.model : 'mock',
    analysisVersion: '1.0.0',
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
  };

  return { repo, cache, queue, limiter, providers, meta };
}
