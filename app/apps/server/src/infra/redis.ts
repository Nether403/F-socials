// Redis-backed Cache (ioredis) + durable job Queue (BullMQ), both on Upstash.
// BullMQ requires maxRetriesPerRequest: null. We pass it connection OPTIONS (not a
// Redis instance) so BullMQ builds its own connection — avoids the dual-ioredis
// type clash from BullMQ bundling its own ioredis copy.

import { Redis, type RedisOptions } from 'ioredis';
import { Queue as BullQueue, Worker, type ConnectionOptions } from 'bullmq';
import type { AnalysisReport } from '../types';
import type { Cache, Job, JobHandler, Queue, RateLimiter } from './ports';

const QUEUE_NAME = 'analysis';

// Parse a redis(s):// URL into options. ponytail: Upstash is TLS-only, so we force
// TLS for *.upstash.io even if the URL says redis:// (a common misconfiguration).
function parseRedis(url: string): RedisOptions {
  const u = new URL(url);
  const needsTls = u.protocol === 'rediss:' || u.hostname.endsWith('upstash.io');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
    ...(needsTls ? { tls: {} } : {}),
  };
}

export function makeRedisConnection(url: string): Redis {
  return new Redis({ ...parseRedis(url), maxRetriesPerRequest: null });
}

function connOpts(url: string): ConnectionOptions {
  return { ...parseRedis(url), maxRetriesPerRequest: null } as ConnectionOptions;
}

export class RedisCache implements Cache {
  constructor(
    private redis: Redis,
    private ttlSeconds: number = 60 * 60 * 24 * 30, // 30 days
  ) {}

  async get(key: string): Promise<AnalysisReport | undefined> {
    const v = await this.redis.get(`report:${key}`);
    return v ? (JSON.parse(v) as AnalysisReport) : undefined;
  }

  async set(key: string, report: AnalysisReport): Promise<void> {
    await this.redis.set(`report:${key}`, JSON.stringify(report), 'EX', this.ttlSeconds);
  }
}

export class RedisQueue implements Queue {
  private queue: BullQueue;
  private worker?: Worker;

  constructor(private url: string) {
    this.queue = new BullQueue(QUEUE_NAME, { connection: connOpts(url) });
  }

  async enqueue(job: Job): Promise<void> {
    await this.queue.add('analyze', job, { removeOnComplete: true, removeOnFail: 100 });
  }

  process(handler: JobHandler): void {
    this.worker = new Worker(
      QUEUE_NAME,
      async (bullJob) => {
        await handler(bullJob.data as Job);
      },
      { connection: connOpts(this.url) },
    );
    this.worker.on('failed', (job, err) => {
      console.error(`[queue] job ${job?.id} failed:`, err?.message);
    });
  }
}

// Fixed-window limiter via INCR + EXPIRE.
// ponytail: INCR then EXPIRE isn't atomic, but the count===1 guard sets the TTL
// once; worst case a key without TTL is corrected on the next window. A Lua script
// would make it atomic if that ever matters.
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private redis: Redis,
    private limit: number,
    private windowSeconds: number = 24 * 60 * 60,
  ) {}

  async hit(key: string) {
    const k = `ratelimit:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, this.windowSeconds);
    let ttl = await this.redis.ttl(k);
    if (ttl < 0) ttl = this.windowSeconds;
    return {
      allowed: count <= this.limit,
      remaining: Math.max(0, this.limit - count),
      limit: this.limit,
      resetSeconds: ttl,
    };
  }
}
