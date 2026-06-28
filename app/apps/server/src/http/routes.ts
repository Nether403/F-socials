// v1 analysis routes. Cache-first submit, status poll, full fetch, public share.

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Cache, Queue, RateLimiter, Repository, Telemetry } from '../infra/ports';
import type { AnalysisReport, ContentItem, RawInput } from '../types';
import { cacheKey } from '../core/hash';
import { policyDescriptor } from '../core/sourceTier';
import { deriveReportReviewStatus } from '../core/reportReviewStatus';
import { submitSchema, disputeSchema, flagSchema, reviewQueueQuerySchema, reviewResolutionSchema } from './validation';
import { requireAuth, reviewerGuard } from './auth';

export function makeRouter(deps: { repo: Repository; cache: Cache; queue: Queue; limiter: RateLimiter; telemetry: Telemetry }): Router {
  const router = Router();

  const paramId = (req: Request): string | undefined => {
    const v = req.params.id;
    return Array.isArray(v) ? v[0] : v;
  };

  // Review_Item id is "{kind}:{sourceId}". Split on the first ':' only (a sourceId
  // could itself contain ':'); require a known kind and a non-empty sourceId.
  const parseReviewItemId = (raw: string | undefined): { kind: 'dispute' | 'flag'; sourceId: string } | null => {
    if (!raw) return null;
    const sep = raw.indexOf(':');
    if (sep <= 0) return null;
    const kind = raw.slice(0, sep);
    const sourceId = raw.slice(sep + 1);
    if ((kind !== 'dispute' && kind !== 'flag') || !sourceId) return null;
    return { kind, sourceId };
  };

  // Overlay the report's DERIVED review status onto the OUTGOING response object
  // only (Req 5.1, 5.2). The persisted report is never rewritten and no
  // gate-relevant field is read or touched, so the invariant gate is preserved by
  // construction (Req 5.4, 10.1, 10.3). When provenance is absent there is no
  // reviewStatus to overlay onto, so the report is returned unchanged (Req 5.5).
  const overlayReviewStatus = async (report: AnalysisReport): Promise<AnalysisReport> => {
    if (!report.provenance) return report;
    const items = await deps.repo.listReviewItems();
    const itemStatuses = items.filter((it) => it.reportId === report.id).map((it) => it.status);
    const derived = deriveReportReviewStatus(report.provenance.reviewStatus, itemStatuses);
    return { ...report, provenance: { ...report.provenance, reviewStatus: derived } };
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
      deps.telemetry.emit('cache_hit', { submissionId: hash, cached: true });
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
    deps.telemetry.emit('cache_miss', { submissionId: hash });

    return res.status(202).json({ reportId: report.id, status: report.status, cached: false });
  });

  // GET /api/v1/analyses/:id — full report.
  router.get('/analyses/:id', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json(await overlayReviewStatus(report));
  });

  // GET /api/v1/analyses/:id/status — lightweight poll for the loading screen.
  router.get('/analyses/:id/status', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json({ reportId: report.id, status: report.status, reasons: report.reasons });
  });

  // POST /api/v1/analyses/:id/disputes — PUBLIC anonymous dispute (no auth). A
  // dispute is persisted with NO user id so anyone can challenge a report (3.1, 3.2).
  router.post('/analyses/:id/disputes', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' }); // 3.6
    const parsed = disputeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // 3.7
    }
    await deps.repo.createDispute({
      id: randomUUID(),
      reportId: id,
      claimId: parsed.data.claimId,
      reason: parsed.data.reason,
      createdAt: new Date().toISOString(),
    });
    deps.telemetry.emit('dispute', { reportId: id, claimId: parsed.data.claimId });
    return res.status(201).json({ ok: true });
  });

  // POST /api/v1/analyses/:id/flags — AUTHENTICATED technique flag. requireAuth
  // rejects anonymous callers (3.3, 3.4); a flag is bound to report + user and
  // must name a technique the report actually surfaced (3.5, 3.6, 3.7).
  router.post('/analyses/:id/flags', requireAuth, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' }); // 3.6
    const parsed = flagSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // 3.7
    }
    const techniques = new Set(report.framingSignals.map((fs) => fs.technique));
    if (!techniques.has(parsed.data.technique)) {
      // 3.7 — can't flag a technique the report never raised.
      return res
        .status(400)
        .json({ error: 'invalid_technique', details: { allowed: [...techniques] } });
    }
    await deps.repo.createFlag({
      id: randomUUID(),
      reportId: id,
      userId: req.user!.id,
      technique: parsed.data.technique,
      note: parsed.data.note,
      createdAt: new Date().toISOString(),
    });
    // No user id is ever emitted — flag has no claimId, so the event carries the report id only.
    deps.telemetry.emit('flag', { reportId: id });
    return res.status(201).json({ ok: true });
  });

  // --- Review workflow (expert-review-queue) -------------------------------
  // Every review route is behind requireAuth + reviewerGuard (Req 1.5): a
  // missing/invalid token → 401 (requireAuth), an authenticated non-reviewer
  // or unconfigured REVIEWER_ROLE → 403 (reviewerGuard).

  // GET /api/v1/review/queue — list Review_Items, optional ?status= filter.
  router.get('/review/queue', requireAuth, reviewerGuard, async (req: Request, res: Response) => {
    const parsed = reviewQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Req 2.5 — invalid filter value: 400, no items.
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const items = await deps.repo.listReviewItems({ status: parsed.data.status });
    return res.status(200).json(items); // Req 2.7 — [] when empty, still 200.
  });

  // POST /api/v1/review/items/:id/claim — claim a pending Review_Item.
  router.post('/review/items/:id/claim', requireAuth, reviewerGuard, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!parseReviewItemId(id)) return res.status(400).json({ error: 'invalid_review_item_id' });
    const result = await deps.repo.claimReviewItem(id!, req.user!.id);
    if (result.ok) return res.status(200).json({ item: result.item }); // Req 3.1, 3.4
    if (result.reason === 'not_found') return res.status(404).json({ error: 'review_item_not_found' }); // Req 3.6
    return res.status(409).json({ error: 'review_item_conflict' }); // Req 3.2, 3.3
  });

  // POST /api/v1/review/items/:id/release — release an item the caller holds.
  router.post('/review/items/:id/release', requireAuth, reviewerGuard, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!parseReviewItemId(id)) return res.status(400).json({ error: 'invalid_review_item_id' });
    const result = await deps.repo.releaseReviewItem(id!, req.user!.id);
    if (result.ok) return res.status(200).json({ item: result.item }); // Req 3.7
    if (result.reason === 'not_found') return res.status(404).json({ error: 'review_item_not_found' });
    if (result.reason === 'not_actionable') return res.status(409).json({ error: 'review_item_not_actionable' }); // Req 3.8
    return res.status(409).json({ error: 'review_item_conflict' });
  });

  // POST /api/v1/review/items/:id/resolution — record a Review_Resolution.
  router.post('/review/items/:id/resolution', requireAuth, reviewerGuard, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!parseReviewItemId(id)) return res.status(400).json({ error: 'invalid_review_item_id' });
    const parsed = reviewResolutionSchema.safeParse(req.body);
    if (!parsed.success) {
      // Req 4.3 — out-of-set outcome or note > 2000: 400, nothing persisted.
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const result = await deps.repo.recordReviewResolution(id!, {
      outcome: parsed.data.outcome,
      note: parsed.data.note,
      reviewer: req.user!.id,
    });
    if (result.ok) return res.status(200).json({ item: result.item }); // Req 4.1, 4.5
    return res.status(404).json({ error: 'review_item_not_found' }); // Req 4.4
  });

  // GET /api/v1/policy — PUBLIC source-tier policy descriptor (no auth). Powers
  // the methodology page so the tiering rules are inspectable (1.6, 2.5).
  router.get('/policy', (_req: Request, res: Response) => {
    return res.json(policyDescriptor());
  });

  // GET /api/v1/r/:slug — PUBLIC read-only shared report (no auth required).
  router.get('/r/:slug', async (req: Request, res: Response) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    if (!slug) return res.status(400).json({ error: 'missing_slug' });
    const report = await deps.repo.getReportBySlug(slug);
    if (!report) return res.status(404).json({ error: 'not_found' });
    return res.json(await overlayReviewStatus(report));
  });

  return router;
}
