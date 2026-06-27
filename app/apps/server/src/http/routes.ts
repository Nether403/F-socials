// v1 analysis routes. Cache-first submit, status poll, full fetch, public share.

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Cache, Queue, RateLimiter, Repository } from '../infra/ports';
import type { AnalysisReport, ContentItem, RawInput } from '../types';
import { cacheKey } from '../core/hash';
import { submitSchema } from './validation';
import { requireAuth } from './auth';

export function makeRouter(deps: { repo: Repository; cache: Cache; queue: Queue; limiter: RateLimiter }): Router {
  const router = Router();

  const paramId = (req: Request): string | undefined => {
    const v = req.params.id;
    return Array.isArray(v) ? v[0] : v;
  };

  // Who am I — protected; proves auth works.
  router.get('/me', requireAuth, (req: Request, res: Response) => {
    return res.json({ user: req.user });
  });

  // POST /api/v1/analyses — submit an input. Cache hit returns instantly.
  router.post('/analyses', async (req: Request, res: Response) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const input: RawInput = parsed.data;
    const hash = cacheKey(input);

    // 1. Cache hit -> serve the existing ready report (does NOT consume quota).
    const cached = await deps.cache.get(hash);
    if (cached) {
      return res.status(200).json({ reportId: cached.id, status: cached.status, cached: true });
    }

    // 2. Rate limit — only NEW analyses (cache misses) count, since those trigger
    //    the paid LLM/transcription/search calls. Keyed per user when logged in,
    //    else per client IP, per day.
    const rlKey = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const rl = await deps.limiter.hit(rlKey);
    res.setHeader('X-RateLimit-Limit', rl.limit);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.resetSeconds);
      return res.status(429).json({
        error: 'rate_limited',
        message: `Daily limit of ${rl.limit} new analyses reached. Try again in ~${Math.ceil(rl.resetSeconds / 3600)}h.`,
        retryAfterSeconds: rl.resetSeconds,
      });
    }

    // 3. Known content but not cached (e.g. still processing / needs_review).
    const existingContent = await deps.repo.findContentByHash(hash);
    const now = new Date().toISOString();

    const content: ContentItem =
      existingContent ?? {
        id: randomUUID(),
        urlHash: hash,
        sourceType: input.sourceType,
        sourceUrl: input.url,
        metadata: {},
        createdAt: now,
      };
    if (!existingContent) await deps.repo.saveContent(content);

    // 4. New report, queued.
    const report: AnalysisReport = {
      id: randomUUID(),
      contentId: content.id,
      urlHash: hash,
      status: 'queued',
      version: 1,
      producingLayer: 'ai',
      claims: [],
      framingSignals: [],
      contextCards: [],
      perspectives: [],
      createdAt: now,
      updatedAt: now,
    };
    await deps.repo.saveReport(report);
    await deps.queue.enqueue({ reportId: report.id, contentId: content.id, urlHash: hash, input });

    return res.status(202).json({ reportId: report.id, status: report.status, cached: false });
  });

  // GET /api/v1/analyses/:id — full report.
  router.get('/analyses/:id', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json(report);
  });

  // GET /api/v1/analyses/:id/status — lightweight poll for the loading screen.
  router.get('/analyses/:id/status', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json({ reportId: report.id, status: report.status, reasons: report.reasons });
  });

  // GET /api/v1/r/:slug — PUBLIC read-only shared report (no auth required).
  router.get('/r/:slug', async (req: Request, res: Response) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    if (!slug) return res.status(400).json({ error: 'missing_slug' });
    const report = await deps.repo.getReportBySlug(slug);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json(report);
  });

  return router;
}
