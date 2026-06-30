import './env'; // side-effect: load .env before reading process.env below
import type { Capability, TrustThresholds } from './core/trustGate';

// Parse a boolean env var: "true"/"1" → true, "false"/"0" → false, unset → fallback.
function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

// Parse a numeric env var: valid finite number → that number, anything else → fallback.
function numEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = parseFloat(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

// Parse a trust-gate threshold env var into the [0,1] range: unset/invalid → 0.0,
// out-of-range finite values clamp to the nearest bound (Req 1.5, 12.2).
function thresholdEnv(value: string | undefined): number {
  const n = numEnv(value, 0.0);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

const isDeployed = process.env.NODE_ENV === 'production';

export const CONCURRENCY_CAP_DEFAULT = 4;
const CONCURRENCY_CAP_MIN = 1;
const CONCURRENCY_CAP_MAX = 32;

// Resolve CONCURRENCY_CAP from its raw env string. Valid = an integer in [1,32]; anything
// absent, empty, non-numeric, non-integer, or out of range falls back to the documented
// default 4 (rejected to default, NOT clamped) and returns a warning naming the variable
// (Req 2.2, 2.3, 2.4). Pure → unit/property tested.
export function resolveConcurrencyCap(raw: string | undefined): { value: number; warning?: string } {
  const n = Number(raw);
  const valid =
    raw !== undefined && raw.trim() !== '' &&
    Number.isInteger(n) && n >= CONCURRENCY_CAP_MIN && n <= CONCURRENCY_CAP_MAX;
  if (valid) return { value: n };
  return {
    value: CONCURRENCY_CAP_DEFAULT,
    warning: `CONCURRENCY_CAP invalid or unset (${String(raw)}); using default ${CONCURRENCY_CAP_DEFAULT}`,
  };
}

const concurrency = resolveConcurrencyCap(process.env.CONCURRENCY_CAP);
if (concurrency.warning) console.warn(`[config] ${concurrency.warning}`); // warn, do not abort (Req 2.4)

export const config = {
  // Deployed configuration runs API and Worker as separate processes (5.10);
  // local dev keeps the single-process experience by running the worker in-process.
  // Default: true in dev, false when deployed (NODE_ENV=production). Override via RUN_WORKER_IN_PROCESS.
  runWorkerInProcess: boolEnv(process.env.RUN_WORKER_IN_PROCESS, !isDeployed),
  port: Number(process.env.PORT ?? 4000),
  rateLimitAnonPerDay: Number(process.env.RATE_LIMIT_ANON_PER_DAY ?? 10),
  // bounded-concurrency cap for parallel evidence lookups; shared by API and worker (Req 2.6)
  concurrencyCap: concurrency.value,
  // infra drivers
  repoDriver: process.env.REPO_DRIVER ?? 'memory', // memory | postgres
  cacheDriver: process.env.CACHE_DRIVER ?? 'memory', // memory | upstash
  queueDriver: process.env.QUEUE_DRIVER ?? 'memory', // memory | upstash
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '', // set in prod (web origin); empty = no CORS headers (dev proxy)
  // Reviewer role gating the review routes; matched against the JWT `role` claim.
  // Empty (unset) ⇒ fail closed: every review route is denied (Req 1.6).
  reviewerRole: process.env.REVIEWER_ROLE ?? '',
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
  // Telemetry (observability): read once here, shared byte-for-byte by API and Worker.
  // Verbatim trimmed env value, or '' when unset or whitespace-only (Req 2.2, 2.3, 2.4).
  // An empty string classifies the backend as not configured (Req 2.5, see isTelemetryConfigured).
  // Deliberately NOT added to missingRequiredConfig — absent telemetry never blocks startup (Req 3.3).
  sentryDsn: (process.env.SENTRY_DSN ?? '').trim(),
  posthogKey: (process.env.POSTHOG_KEY ?? '').trim(),

  // Per-capability trust-gate thresholds, exposed on the config object but read LIVE
  // on every access (getter re-reads process.env), so a threshold/legal-flag change
  // takes effect on the next evaluation with no restart (Req 1.7, 1.9, 12.4).
  // Env is the floor; callers needing repo overrides pass them to getTrustGateConfig().
  get trustThresholds(): Record<Capability, TrustThresholds> {
    return getTrustGateConfig();
  },
};

// A telemetry backend is "configured" only when its config value is a non-empty string;
// '' (unset or whitespace-only) ⇒ not configured, so the backend is skipped (Req 2.5, 2.6).
export function isTelemetryConfigured(value: string): boolean {
  return value !== '';
}

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

// Trust gate — per-capability thresholds, read live every evaluation (Req 1.5, 1.7, 1.8, 12.2, 12.4, 12.6).
// Defaults are 0.0/false so every capability is dark until explicitly enabled.
// Never hard-codes passing values. Supports optional repo override (env as the floor).
export function getTrustGateConfig(
  repoOverrides?: Partial<Record<Capability, Partial<TrustThresholds>>>,
): Record<Capability, TrustThresholds> {
  const env = process.env;
  const base: Record<Capability, TrustThresholds> = {
    feed_friction: {
      citationCoverageMin: thresholdEnv(env.TRUST_FEED_COVERAGE_MIN),
      modelHumanAgreementMin: thresholdEnv(env.TRUST_FEED_AGREEMENT_MIN),
      legalReviewComplete: boolEnv(env.TRUST_FEED_LEGAL_OK, false),
    },
    institutional_api: {
      citationCoverageMin: thresholdEnv(env.TRUST_API_COVERAGE_MIN),
      modelHumanAgreementMin: thresholdEnv(env.TRUST_API_AGREEMENT_MIN),
      legalReviewComplete: boolEnv(env.TRUST_API_LEGAL_OK, false),
    },
    coaching: {
      citationCoverageMin: thresholdEnv(env.TRUST_COACH_COVERAGE_MIN),
      modelHumanAgreementMin: thresholdEnv(env.TRUST_COACH_AGREEMENT_MIN),
      legalReviewComplete: boolEnv(env.TRUST_COACH_LEGAL_OK, false),
    },
  };

  if (!repoOverrides) return base;

  // Merge: repo row overrides only when its value exceeds the env floor (env is the minimum).
  for (const cap of Object.keys(base) as Capability[]) {
    const over = repoOverrides[cap];
    if (!over) continue;
    if (over.citationCoverageMin !== undefined && over.citationCoverageMin > base[cap].citationCoverageMin) {
      base[cap].citationCoverageMin = over.citationCoverageMin;
    }
    if (over.modelHumanAgreementMin !== undefined && over.modelHumanAgreementMin > base[cap].modelHumanAgreementMin) {
      base[cap].modelHumanAgreementMin = over.modelHumanAgreementMin;
    }
    // legalReviewComplete: repo can only make it stricter (true overrides false is meaningless;
    // but if env is true and repo says false, env floor wins → keep true)
    if (over.legalReviewComplete !== undefined) {
      base[cap].legalReviewComplete = base[cap].legalReviewComplete || over.legalReviewComplete;
    }
  }

  return base;
}
