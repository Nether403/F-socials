import './env'; // side-effect: load .env before reading process.env below

// Parse a boolean env var: "true"/"1" → true, "false"/"0" → false, unset → fallback.
function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const isDeployed = process.env.NODE_ENV === 'production';

export const config = {
  // Deployed configuration runs API and Worker as separate processes (5.10);
  // local dev keeps the single-process experience by running the worker in-process.
  // Default: true in dev, false when deployed (NODE_ENV=production). Override via RUN_WORKER_IN_PROCESS.
  runWorkerInProcess: boolEnv(process.env.RUN_WORKER_IN_PROCESS, !isDeployed),
  port: Number(process.env.PORT ?? 4000),
  rateLimitAnonPerDay: Number(process.env.RATE_LIMIT_ANON_PER_DAY ?? 10),
  // infra drivers
  repoDriver: process.env.REPO_DRIVER ?? 'memory', // memory | postgres
  cacheDriver: process.env.CACHE_DRIVER ?? 'memory', // memory | upstash
  queueDriver: process.env.QUEUE_DRIVER ?? 'memory', // memory | upstash
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '', // set in prod (web origin); empty = no CORS headers (dev proxy)
  // provider selectors
  llmProvider: process.env.LLM_PROVIDER ?? 'mock', // mock | gemini
  evidenceProvider: process.env.EVIDENCE_PROVIDER ?? 'mock', // mock | google_factcheck | gdelt | tavily | chain
  perspectiveProvider: process.env.PERSPECTIVE_PROVIDER ?? 'mock', // mock | bridging
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
    backupModel: process.env.GEMINI_MODEL_BACKUP ?? '',
  },
  factCheck: {
    apiKey: process.env.GOOGLE_FACTCHECK_API_KEY ?? '',
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY ?? '',
  },
  supadata: {
    apiKey: process.env.SUPADATA_API_KEY ?? '',
  },
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY ?? '',
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
};

type Env = Record<string, string | undefined>;

// Pure: which required-but-absent config values block the given mode. Returns
// names (not values) so callers can report them (5.11). Access controls
// (SUPABASE_JWT_SECRET, the rate limiter) are intentionally excluded — they
// degrade with a warning rather than block startup (5.12).
//
// `dev` requires nothing (memory drivers, no CORS); only `deployed` is gated.
export function missingRequiredConfig(env: Env, mode: 'deployed' | 'dev'): string[] {
  if (mode !== 'deployed') return [];
  const absent = (name: string) => !env[name]; // undefined or empty string
  const missing: string[] = [];
  if (env.REPO_DRIVER === 'postgres' && absent('DATABASE_URL')) missing.push('DATABASE_URL');
  if ((env.CACHE_DRIVER === 'upstash' || env.QUEUE_DRIVER === 'upstash') && absent('REDIS_URL')) {
    missing.push('REDIS_URL');
  }
  if (absent('CORS_ORIGIN')) missing.push('CORS_ORIGIN');
  return missing;
}
