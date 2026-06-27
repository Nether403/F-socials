import './env'; // side-effect: load .env before reading process.env below

export const config = {
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
