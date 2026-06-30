// v1 analysis routes. Cache-first submit, status poll, full fetch, public share.

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Cache, Queue, RateLimiter, Repository, Telemetry, WorkspaceRole } from '../infra/ports';
import type { AnalysisReport, ContentItem, RawInput } from '../types';
import { cacheKey } from '../core/hash';
import { policyDescriptor } from '../core/sourceTier';
import { deriveReportReviewStatus } from '../core/reportReviewStatus';
import { buildTrustMetrics } from '../core/metricsStore';
import { evaluateTrustGate } from '../core/trustGate';
import { projectFrictionOverlay } from '../core/frictionOverlay';
import { analyzeDraft, type LLMProvider } from '../core/coaching';
import {
  submitSchema,
  disputeSchema,
  flagSchema,
  reviewQueueQuerySchema,
  reviewResolutionSchema,
  reportIdParam,
  workspaceNameSchema,
  collectionNameSchema,
  collectionItemSchema,
  annotationTextSchema,
  inviteCodeParam,
  frictionQuerySchema,
  coachingBodySchema,
} from './validation';
import { requireAuth, reviewerGuard, apiKeyAuth } from './auth';
import { sendNeutral } from './respond';
import { config } from '../config';
import { resolveRateConfig } from '../concurrency';
import { graphql } from 'graphql';
import { schema } from '../graphql/schema';
import { makeRootValue } from '../graphql/resolvers';

// ponytail: per-user rolling-window limiter for the coaching endpoint — 10
// requests / 60s, keyed by `user:<jwt sub>` (Req 10.8). Module-level Map, so it
// persists across requests for the life of the process. Ceiling: per-process
// only — a multi-instance deploy enforces the limit per instance, not globally.
// We can't reuse repo.institutionalHit here: its Postgres backing table keys on a
// UUID FK into api_keys, so a `user:<sub>` key would fail the cast/constraint.
// Upgrade path: a repo-backed rolling counter with in-memory + Postgres parity.
const COACHING_LIMIT = 10;
const COACHING_WINDOW_MS = 60_000;
const coachingHits = new Map<string, number[]>();

function coachingRateHit(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const cutoff = now - COACHING_WINDOW_MS;
  const recent = (coachingHits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= COACHING_LIMIT) {
    // Retry-After = whole seconds until the oldest in-window hit ages out.
    const oldest = recent[0]!;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + COACHING_WINDOW_MS - now) / 1000));
    coachingHits.set(key, recent);
    return { allowed: false, retryAfterSeconds };
  }
  recent.push(now);
  coachingHits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function makeRouter(deps: { repo: Repository; cache: Cache; queue: Queue; limiter: RateLimiter; telemetry: Telemetry; coachingLLM?: LLMProvider }): Router {
  const router = Router();

  const paramId = (req: Request): string | undefined => {
    const v = req.params.id;
    return Array.isArray(v) ? v[0] : v;
  };

  const getParam = (req: Request, key: string): string | undefined => {
    const v = req.params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  // The single workspace authorization decision (Req 8.2, 8.3, 8.5, 8.7). Returns
  // the reader's role on success, or writes the 404/403 response and returns
  // undefined. Workspace non-existence is checked FIRST so a missing workspace
  // yields 404 and an existing-but-not-mine workspace yields 403 (the 404-before-403
  // information policy). Owner-only routes additionally require role === 'owner'.
  const loadMembership = async (
    res: Response,
    workspaceId: string,
    readerId: string,
  ): Promise<WorkspaceRole | undefined> => {
    if (!(await deps.repo.workspaceExists(workspaceId))) {
      res.status(404).json({ error: 'not_found' }); // Req 8.7
      return undefined;
    }
    const role = await deps.repo.getMembership(workspaceId, readerId);
    if (role === undefined) {
      res.status(403).json({ error: 'forbidden' }); // Req 8.2
      return undefined;
    }
    return role;
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

  // --- Saved reports (accounts-save-history) -------------------------------
  // All three are behind requireAuth (Req 10.1–10.3, 10.6) and scoped to the
  // verified reader req.user!.id (Req 10.5). Persistence goes through Repository
  // methods only — no SQL here (Req 11.1). Telemetry carries the report id only,
  // never the reader id, matching the flag-event convention (Req 12.4, 12.5).

  // POST /api/v1/analyses/:id/save — save a report to the reader's account.
  router.post('/analyses/:id/save', requireAuth, async (req: Request, res: Response) => {
    const parsed = reportIdParam.safeParse(paramId(req));
    if (!parsed.success) return res.status(400).json({ error: 'invalid_id' }); // Req 10.4
    const id = parsed.data;
    const report = await deps.repo.getReport(id);
    if (!report) return res.status(404).json({ error: 'not_found' }); // Req 7.4
    await deps.repo.saveSavedReport(req.user!.id, id); // idempotent (Req 7.3)
    deps.telemetry.emit('save', { reportId: id });
    return res.status(200).json({ ok: true, saved: true });
  });

  // DELETE /api/v1/analyses/:id/save — remove a report from the reader's set.
  // Idempotent success even when the report was never saved — no 404 (Req 8.3, 10.7).
  router.delete('/analyses/:id/save', requireAuth, async (req: Request, res: Response) => {
    const parsed = reportIdParam.safeParse(paramId(req));
    if (!parsed.success) return res.status(400).json({ error: 'invalid_id' }); // Req 10.4
    const id = parsed.data;
    await deps.repo.removeSavedReport(req.user!.id, id);
    deps.telemetry.emit('unsave', { reportId: id });
    return res.status(200).json({ ok: true, saved: false });
  });

  // GET /api/v1/saved-reports — reverse-chronological history for the verified
  // reader (Req 9.1, 9.6). [] when the reader has no saves (Req 10.8).
  router.get('/saved-reports', requireAuth, async (req: Request, res: Response) => {
    const entries = await deps.repo.listSavedReports(req.user!.id);
    return res.status(200).json(entries);
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

  // --- Institutional workspace (institutional-workspace) -------------------
  // Every route is behind requireAuth (Req 8.1); the reader is always the verified
  // req.user!.id. Workspace-scoped routes call loadMembership before any read or
  // write (Req 8.2, 8.5), with owner-only routes additionally requiring the Owner
  // Role (Req 8.3). Persistence goes through Repository methods only — no SQL here
  // (Req 9.1). Telemetry carries the workspace/report id only, never the reader id.

  // POST /api/v1/workspaces — create a workspace; seeds the owner Membership (Req 1.1, 1.2).
  router.post('/workspaces', requireAuth, async (req: Request, res: Response) => {
    const parsed = workspaceNameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // Req 1.4
    const summary = await deps.repo.createWorkspace(req.user!.id, parsed.data.name);
    deps.telemetry.emit('workspace_create', { workspaceId: summary.id });
    return res.status(201).json(summary);
  });

  // GET /api/v1/workspaces — the reader's workspaces; [] when none (Req 4.1, 4.3).
  router.get('/workspaces', requireAuth, async (req: Request, res: Response) => {
    const list = await deps.repo.listWorkspacesForReader(req.user!.id);
    return res.status(200).json(list);
  });

  // POST /api/v1/workspaces/:id/invites — owner-only invite issuance (Req 2.1, 2.2).
  router.post('/workspaces/:id/invites', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    if (role !== 'owner') return res.status(403).json({ error: 'forbidden' }); // Req 2.2
    const code = await deps.repo.createInvite(id);
    deps.telemetry.emit('workspace_invite', { workspaceId: id });
    return res.status(200).json({ code });
  });

  // POST /api/v1/invites/:code/redeem — redeem a code; 404 unknown (Req 2.3, 2.4, 2.5).
  router.post('/invites/:code/redeem', requireAuth, async (req: Request, res: Response) => {
    const parsed = inviteCodeParam.safeParse(getParam(req, 'code'));
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const result = await deps.repo.redeemInvite(parsed.data, req.user!.id);
    if (!result) return res.status(404).json({ error: 'not_found' }); // Req 2.4
    deps.telemetry.emit('workspace_redeem', { workspaceId: result.workspaceId });
    return res.status(200).json(result); // { workspaceId, role }
  });

  // GET /api/v1/workspaces/:id/members — member-scoped member list (Req 3.1).
  router.get('/workspaces/:id/members', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const members = await deps.repo.listMembers(id);
    return res.status(200).json(members);
  });

  // DELETE /api/v1/workspaces/:id/members/:readerId — owner-only removal; the owner
  // cannot remove their own Membership (Req 3.2, 3.3, 3.4).
  router.delete('/workspaces/:id/members/:readerId', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    const targetReader = getParam(req, 'readerId');
    if (!id || !targetReader) return res.status(400).json({ error: 'missing_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    if (role !== 'owner') return res.status(403).json({ error: 'forbidden' }); // Req 3.3
    // Owner self-removal → 400 BEFORE any delete; the Owner Membership is untouched (Req 3.4).
    if (targetReader === req.user!.id) return res.status(400).json({ error: 'cannot_remove_self' });
    await deps.repo.removeMember(id, targetReader);
    deps.telemetry.emit('workspace_member_remove', { workspaceId: id });
    return res.status(200).json({ ok: true });
  });

  // POST /api/v1/workspaces/:id/collections — member creates a collection (Req 5.1).
  router.post('/workspaces/:id/collections', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const parsed = collectionNameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // Req 5.4
    const collection = await deps.repo.createCollection(id, parsed.data.name);
    deps.telemetry.emit('collection_create', { workspaceId: id });
    return res.status(201).json(collection);
  });

  // GET /api/v1/workspaces/:id/collections — member lists collections (Req 5.2).
  router.get('/workspaces/:id/collections', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const collections = await deps.repo.listCollections(id);
    return res.status(200).json(collections);
  });

  // DELETE /api/v1/workspaces/:id/collections/:cid — owner-only; drops the
  // collection and its items together (Req 5.5, 5.6).
  router.delete('/workspaces/:id/collections/:cid', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const cid = reportIdParam.safeParse(getParam(req, 'cid'));
    if (!cid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    if (role !== 'owner') return res.status(403).json({ error: 'forbidden' }); // Req 5.6
    await deps.repo.deleteCollection(id, cid.data);
    deps.telemetry.emit('collection_delete', { workspaceId: id });
    return res.status(200).json({ ok: true });
  });

  // POST /api/v1/workspaces/:id/collections/:cid/items — member adds a report;
  // idempotent; 404 when the report does not exist (Req 6.1, 6.2, 6.3).
  router.post('/workspaces/:id/collections/:cid/items', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const cid = reportIdParam.safeParse(getParam(req, 'cid'));
    if (!cid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const parsed = collectionItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    const report = await deps.repo.getReport(parsed.data.reportId);
    if (!report) return res.status(404).json({ error: 'not_found' }); // Req 6.3
    await deps.repo.addCollectionItem(cid.data, parsed.data.reportId);
    deps.telemetry.emit('collection_item_add', { workspaceId: id, reportId: parsed.data.reportId });
    return res.status(200).json({ ok: true });
  });

  // GET /api/v1/workspaces/:id/collections/:cid/items — member lists items,
  // most-recently-added first (Req 6.4).
  router.get('/workspaces/:id/collections/:cid/items', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const cid = reportIdParam.safeParse(getParam(req, 'cid'));
    if (!cid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const items = await deps.repo.listCollectionItems(cid.data);
    return res.status(200).json(items);
  });

  // DELETE /api/v1/workspaces/:id/collections/:cid/items/:reportId — member
  // removes a report; success even if absent (Req 6.5, 6.6).
  router.delete('/workspaces/:id/collections/:cid/items/:reportId', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const cid = reportIdParam.safeParse(getParam(req, 'cid'));
    if (!cid.success) return res.status(400).json({ error: 'invalid_id' });
    const rid = reportIdParam.safeParse(getParam(req, 'reportId'));
    if (!rid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    await deps.repo.removeCollectionItem(cid.data, rid.data);
    deps.telemetry.emit('collection_item_remove', { workspaceId: id, reportId: rid.data });
    return res.status(200).json({ ok: true });
  });

  // POST /api/v1/workspaces/:id/reports/:reportId/annotations — member annotates a
  // report; 404 when the report does not exist (Req 7.1, 7.6, 7.7).
  router.post('/workspaces/:id/reports/:reportId/annotations', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const rid = reportIdParam.safeParse(getParam(req, 'reportId'));
    if (!rid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const parsed = annotationTextSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // Req 7.6
    const report = await deps.repo.getReport(rid.data);
    if (!report) return res.status(404).json({ error: 'not_found' }); // Req 7.7
    const annotation = await deps.repo.createAnnotation({
      workspaceId: id,
      reportId: rid.data,
      authorId: req.user!.id,
      text: parsed.data.text,
    });
    deps.telemetry.emit('annotation_create', { workspaceId: id, reportId: rid.data });
    return res.status(201).json(annotation);
  });

  // GET /api/v1/workspaces/:id/reports/:reportId/annotations — member lists the
  // report's annotations in this workspace, most-recently-created first (Req 7.2).
  router.get('/workspaces/:id/reports/:reportId/annotations', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const rid = reportIdParam.safeParse(getParam(req, 'reportId'));
    if (!rid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const annotations = await deps.repo.listAnnotations(id, rid.data);
    return res.status(200).json(annotations);
  });

  // PATCH /api/v1/workspaces/:id/annotations/:aid — author-or-owner edits the text
  // (Req 7.3, 7.4, 7.6). An annotation absent or in another workspace → 404.
  router.patch('/workspaces/:id/annotations/:aid', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const aid = reportIdParam.safeParse(getParam(req, 'aid'));
    if (!aid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const parsed = annotationTextSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() }); // Req 7.6
    const annotation = await deps.repo.getAnnotation(aid.data);
    if (!annotation || annotation.workspaceId !== id) return res.status(404).json({ error: 'not_found' });
    // Author-or-owner predicate (Req 7.3, 7.4).
    if (annotation.authorId !== req.user!.id && role !== 'owner') return res.status(403).json({ error: 'forbidden' });
    await deps.repo.updateAnnotation(aid.data, parsed.data.text);
    deps.telemetry.emit('annotation_update', { workspaceId: id, reportId: annotation.reportId });
    return res.status(200).json({ ok: true });
  });

  // DELETE /api/v1/workspaces/:id/annotations/:aid — author-or-owner deletes
  // (Req 7.4, 7.5). An annotation absent or in another workspace → 404.
  router.delete('/workspaces/:id/annotations/:aid', requireAuth, async (req: Request, res: Response) => {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const aid = reportIdParam.safeParse(getParam(req, 'aid'));
    if (!aid.success) return res.status(400).json({ error: 'invalid_id' });
    const role = await loadMembership(res, id, req.user!.id);
    if (role === undefined) return;
    const annotation = await deps.repo.getAnnotation(aid.data);
    if (!annotation || annotation.workspaceId !== id) return res.status(404).json({ error: 'not_found' });
    // Author-or-owner predicate (Req 7.4, 7.5).
    if (annotation.authorId !== req.user!.id && role !== 'owner') return res.status(403).json({ error: 'forbidden' });
    await deps.repo.deleteAnnotation(aid.data);
    deps.telemetry.emit('annotation_delete', { workspaceId: id, reportId: annotation.reportId });
    return res.status(200).json({ ok: true });
  });

  // GET /api/v1/policy — PUBLIC source-tier policy descriptor (no auth). Powers
  // the methodology page so the tiering rules are inspectable (1.6, 2.5).
  router.get('/policy', (_req: Request, res: Response) => {
    return res.json(policyDescriptor());
  });

  // GET /api/v1/friction?url=<feed URL> — PUBLIC lens-safe overlay for an
  // already-analyzed feed item (no auth — the payload carries no verdict and no
  // creator rating; Req 1.1, 2.2). Read-only: it consumes the readiness the
  // pipeline already produced and never calls assembleReport.
  router.get('/friction', async (req: Request, res: Response) => {
    // 1. Validate query (required url) at the trust boundary.
    const parsed = frictionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }

    // 2. Feed_Friction trust gate, re-evaluated live every request (Req 1.4, 5.6).
    //    Fail-closed: any undefined metric or unset legal flag ⇒ 503.
    const metrics = await buildTrustMetrics({ repo: deps.repo });
    const gate = evaluateTrustGate(metrics, config.trustThresholds.feed_friction);
    if (!gate.satisfied) {
      return res.status(503).json({ error: 'capability_unavailable' });
    }

    // 3. Resolve the stored content for this feed URL using the SAME content-hash
    //    normalization the analysis intake keyed under. The cacheKey baked in the
    //    sourceType, so try the url-bearing source types (youtube|article) and
    //    take the first that resolves a ready report.
    // ponytail: the ready report is read from the urlHash→ready-report cache (the
    //    only content→report link the repo exposes). Ceiling: a cold cache 404s a
    //    ready report (safe withhold, never a false overlay); upgrade path is a
    //    repo.getReportByContentId index.
    let report: AnalysisReport | undefined;
    for (const sourceType of ['youtube', 'article'] as const) {
      const hash = cacheKey({ sourceType, url: parsed.data.url });
      const content = await deps.repo.findContentByHash(hash);
      if (!content) continue;
      report = await deps.cache.get(hash);
      if (report) break;
    }

    // 4. Missing OR not ready ⇒ 404, no overlay (Req 2.3).
    if (!report || report.status !== 'ready') {
      return res.status(404).json({ error: 'not_found' });
    }

    // 5. Pure projection, then the neutrality boundary (withholds → 404 on fail; Req 15.7).
    const overlay = projectFrictionOverlay(report, config.corsOrigin);
    return sendNeutral(res, 200, overlay);
  });

  // POST /api/v1/coaching — authenticated, advisory-only pre-publish coaching.
  // Order is load-bearing: auth → validate → trust gate → rate limit → analyze →
  // neutrality boundary. The Coaching_Engine holds no repo/queue/telemetry handle,
  // so the draft is analyzed ephemerally and NOTHING is persisted
  // (Req 10.5, 10.6, 10.7, 10.8, 11.7, 12.1, 15.7).
  router.post('/coaching', requireAuth, async (req: Request, res: Response) => {
    // 1. requireAuth (above) already 401s without a valid Access_Token — the engine
    //    is never invoked for an unauthenticated caller (Req 10.6).

    // 2. Validate body: draft trimmed length 1..50000 (Req 10.5). On invalid input
    //    the engine is NOT invoked.
    const parsed = coachingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }

    // 3. Coaching trust gate, re-evaluated live every request (Req 12.1). Fail-closed:
    //    any undefined metric or unset legal flag ⇒ 503, engine not invoked. Because
    //    the gate defaults dark, this 503s before coachingLLM is ever needed.
    const gate = evaluateTrustGate(await buildTrustMetrics({ repo: deps.repo }), config.trustThresholds.coaching);
    if (!gate.satisfied) {
      return res.status(503).json({ error: 'coaching_unavailable' });
    }

    // 4. Per-user rolling rate limit: 10 requests / 60s keyed by `user:<jwt sub>` (Req 10.8).
    const rl = coachingRateHit(`user:${req.user!.id}`);
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.retryAfterSeconds); // whole seconds to window reset
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds });
    }

    // 5. Gate satisfied but the LLM provider seam isn't wired yet (pre-14.1) ⇒ 500
    //    rather than invoke a missing dependency (Req 11.7).
    if (!deps.coachingLLM) {
      return res.status(500).json({ error: 'coaching_unavailable' });
    }

    // 6. Analyze the draft under a ≤30s budget. Timeout OR any thrown error ⇒ 500,
    //    nothing persisted (Req 10.7, 11.7). analyzeDraft itself never persists and
    //    degrades gracefully, so the timeout is the real failure mode here.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        analyzeDraft(parsed.data.draft, { llm: deps.coachingLLM }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('coaching_timeout')), 30_000);
        }),
      ]);
      // 7. Neutrality boundary (withholds on fail; Req 15.7), else 200.
      return sendNeutral(res, 200, result);
    } catch {
      return res.status(500).json({ error: 'coaching_unavailable' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  // POST /api/v1/graphql — Institutional API: API-key-authenticated, per-key
  // rate-limited, trust-gated, read-only GraphQL over the Report_Graph. Order is
  // load-bearing: auth → rate limit → gate → execute (Req 1.2, 1.4, 7.6, 7.8,
  // 8.1, 8.3, 9.5, 15.7).
  router.post('/graphql', apiKeyAuth(deps.repo), async (req: Request, res: Response) => {
    // 1. apiKeyAuth (above) already 401s a missing/revoked/unknown key BEFORE we
    //    reach here, so the query is neither executed nor rate-counted for those.

    // 2. Per-key fixed-window rate limit (Req 8.1, 8.3). resolveRateConfig applies
    //    the 100/60s default and clamps the window to [1, 86400].
    const cfg = resolveRateConfig(req.apiKey?.rateLimit);
    const rl = await deps.repo.institutionalHit(req.apiKey!.keyId, cfg);
    res.setHeader('X-RateLimit-Limit', rl.limit);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.resetSeconds); // whole seconds to window reset
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: rl.resetSeconds });
    }

    // 3. Institutional_API trust gate, re-evaluated live every request (Req 1.4).
    //    Fail-closed: any undefined metric or unset legal flag ⇒ 503.
    const gate = evaluateTrustGate(await buildTrustMetrics({ repo: deps.repo }), config.trustThresholds.institutional_api);
    if (!gate.satisfied) {
      return res.status(503).json({ error: 'capability_unavailable' });
    }

    // 4. Read-only GraphQL execution. Invalid syntax/unknown fields yield a
    //    structured `errors` response automatically and resolvers are not run (Req 7.8).
    const result = await graphql({
      schema,
      source: req.body?.query ?? '',
      rootValue: makeRootValue(deps.repo),
      variableValues: req.body?.variables,
    });

    // 5. Neutrality boundary. Standard GraphQL-over-HTTP returns 200 even when the
    //    result carries `errors` (Req 15.7).
    return sendNeutral(res, 200, result);
  });

  // --- Institutional API key administration (intervention-and-scale) ---------
  // ponytail: these are admin routes. The design (Req 6.5) calls for a separate
  // key-admin auth path distinct from the reader JWT, but no institutional-admin
  // authz seam exists in this codebase yet. Following the repo convention that
  // mutating/identity routes are gated, they sit behind requireAuth for now;
  // upgrade path is a dedicated institutional-admin guard (e.g. an admin role /
  // separate admin token) layered here once that seam lands. Do NOT serve these
  // anonymously in production.

  // POST /api/v1/institutions/:institutionId/keys — issue a new API key. The
  // plaintext is generated (randomBytes(32).base64url), only its SHA-256 hash is
  // persisted, and it is returned ONCE here — unrecoverable afterward (Req 6.1, 6.8).
  router.post('/institutions/:institutionId/keys', requireAuth, async (req: Request, res: Response) => {
    const institutionId = getParam(req, 'institutionId');
    if (!institutionId) return res.status(400).json({ error: 'missing_institution_id' });
    try {
      const { keyId, plaintext } = await deps.repo.createApiKey(institutionId);
      // Plaintext shown exactly once (Req 6.1, 6.8).
      return res.status(201).json({ apiKey: plaintext, keyId });
    } catch (err) {
      // Active-key limit (≤10 per institution) ⇒ 409, no key persisted (Req 6.7).
      if (err instanceof Error && /ActiveKeyLimit/.test(err.message)) {
        return res.status(409).json({ error: 'active_key_limit' });
      }
      throw err;
    }
  });

  // DELETE /api/v1/institutions/:institutionId/keys/:keyId — revoke a key.
  // Revocation flips revoked_at, effective immediately (≤60s; Req 6.4). Idempotent.
  router.delete('/institutions/:institutionId/keys/:keyId', requireAuth, async (req: Request, res: Response) => {
    const keyId = getParam(req, 'keyId');
    if (!keyId) return res.status(400).json({ error: 'missing_key_id' });
    await deps.repo.revokeApiKey(keyId);
    return res.status(204).end();
  });

  // GET /api/v1/institutions/:institutionId/keys/:keyId/value — always 404.
  // The plaintext is never stored and is unrecoverable after issuance (Req 6.8).
  router.get('/institutions/:institutionId/keys/:keyId/value', requireAuth, (_req: Request, res: Response) => {
    return res.status(404).json({ error: 'not_found' });
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
