// Shared composition root: select infra drivers + providers, build the worker
// context. Both the API entrypoint (index.ts) and the worker entrypoint import
// buildContext() so they wire identical infra/providers.
// Swap any in-memory infra or mock provider here when you move to real services.

import { config, isTelemetryConfigured } from './config';
import { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } from './infra/memory';
import { PostgresRepository, makePgPool } from './infra/postgres';
import { RedisCache, RedisQueue, RedisRateLimiter, makeRedisConnection } from './infra/redis';
import type { Cache, Queue, RateLimiter, Repository, Telemetry } from './infra/ports';
import { noopTelemetry } from './infra/telemetry/noop';
import {
  makeActiveTelemetry,
  initSentry,
  initPosthog,
  type ActiveTelemetryDeps,
  type SentryBackend,
  type PostHogBackend,
} from './infra/telemetry/active';
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

// --- telemetry selection (SENTRY_DSN / POSTHOG_KEY in .env) ---
// Mirrors the select* infra functions: each concern (Error_Monitor / Product_Analytics)
// is independently active when its credential is non-empty, else a no-op for that method.
// Both unconfigured ⇒ the shared frozen noopTelemetry. Exactly one [infra] startup log
// names the selection (or `no-op`); a warning names any absent backend; init failure
// degrades to no-op without aborting. Never enters missingRequiredConfig (Req 3.3).
//
// The optional `overrides` exist ONLY so the selection logic is testable without real
// vendor-SDK init (task 5.4): they default to the shared `config` values and the real
// init helpers, so the production call `selectTelemetry()` is unchanged in behaviour.
export interface SelectTelemetryOverrides {
  sentryDsn?: string;
  posthogKey?: string;
  initSentry?: (dsn: string) => SentryBackend;
  initPosthog?: (key: string) => PostHogBackend;
}

export function selectTelemetry(overrides: SelectTelemetryOverrides = {}): Telemetry {
  const sentryDsn = overrides.sentryDsn ?? config.sentryDsn;
  const posthogKey = overrides.posthogKey ?? config.posthogKey;
  const buildSentry = overrides.initSentry ?? initSentry;
  const buildPosthog = overrides.initPosthog ?? initPosthog;

  const sentryConfigured = isTelemetryConfigured(sentryDsn);
  const posthogConfigured = isTelemetryConfigured(posthogKey);

  // Warn naming each absent telemetry variable (Req 1.7, 3.2, 3.6) — degrade, never abort.
  const absent: string[] = [];
  if (!sentryConfigured) absent.push('SENTRY_DSN (Error_Monitor)');
  if (!posthogConfigured) absent.push('POSTHOG_KEY (Product_Analytics)');
  if (absent.length > 0) {
    console.warn(`[infra] Telemetry: ${absent.join(', ')} absent — degrading those concerns to no-op`);
  }

  // Both unconfigured ⇒ shared no-op singleton, one [infra] log (Req 1.4, 3.1, 3.2).
  if (!sentryConfigured && !posthogConfigured) {
    console.log('[infra] Telemetry: no-op');
    return noopTelemetry;
  }

  // Activation behind a try/catch: an SDK init failure warns and falls back to no-op
  // rather than aborting startup (Req 10.5). The init helpers are the only vendor touch.
  try {
    const deps: ActiveTelemetryDeps = {};
    const selected: string[] = [];
    if (sentryConfigured) {
      deps.sentry = buildSentry(sentryDsn);
      selected.push('Sentry (Error_Monitor)');
    }
    if (posthogConfigured) {
      deps.posthog = buildPosthog(posthogKey);
      selected.push('PostHog (Product_Analytics)');
    }
    console.log(`[infra] Telemetry: ${selected.join(' + ')}`);
    return makeActiveTelemetry(deps);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[infra] Telemetry: telemetry initialization failure — falling back to no-op (${msg})`);
    return noopTelemetry;
  }
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
  telemetry: Telemetry;
  providers: Providers;
  meta: WorkerMeta;
}

export function buildContext(): AppContext {
  const repo = selectRepo();
  const cache = selectCache();
  const queue = selectQueue();
  const limiter = selectRateLimiter();
  const telemetry = selectTelemetry();

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

  return { repo, cache, queue, limiter, telemetry, providers, meta };
}
