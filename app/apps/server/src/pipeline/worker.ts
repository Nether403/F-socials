// The worker: consumes jobs, runs the pipeline, persists the report, caches ready ones.

import { randomUUID } from 'node:crypto';
import type { Providers } from '../providers/types';
import type { Cache, Job, Repository } from '../infra/ports';
import type { AnalysisReport } from '../types';
import { runPipeline } from './stages';
import { assertInvariantGateIntact } from '../router/guard';
import { config } from '../config';

function shortSlug(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

export function makeWorker(deps: {
  repo: Repository;
  cache: Cache;
  providers: Providers;
  meta: { model: string; analysisVersion: string; sourcePolicyVersion: string };
}) {
  // Boot guard (Req 9.2): verify the invariant gate (core/assemble.ts) still holds
  // its pinned behavior before accepting any job. A weakened gate throws here, so the
  // worker refuses to start rather than serving unguarded reports.
  assertInvariantGateIntact();

  return async function handleJob(job: Job): Promise<void> {
    const existing = await deps.repo.getReport(job.reportId);
    if (!existing) {
      console.error(`[worker] report ${job.reportId} not found`);
      return;
    }

    const now = new Date().toISOString();
    await deps.repo.saveReport({ ...existing, status: 'processing', updatedAt: now });
    console.log(`[worker] ${job.reportId} -> processing`);

    try {
      const result = await runPipeline(job.input, deps.providers, config.concurrencyCap);
      const finishedAt = new Date().toISOString();
      const finished: AnalysisReport = {
        ...existing,
        status: result.status,
        title: result.title,
        tldr: result.tldr,
        issueFrame: result.issueFrame,
        transcript: result.transcript,
        claims: result.claims,
        framingSignals: result.framingSignals,
        contextCards: result.contextCards,
        perspectives: result.perspectives,
        confidence: result.confidence,
        reasons: result.reasons,
        provenance: {
          model: deps.meta.model,
          analysisVersion: deps.meta.analysisVersion,
          sourcePolicyVersion: deps.meta.sourcePolicyVersion,
          reviewStatus: 'ai-generated',
          lastUpdated: finishedAt,
          disputesCount: 0,
        },
        shareSlug: result.status === 'ready' ? shortSlug() : undefined,
        updatedAt: finishedAt,
      };
      await deps.repo.saveReport(finished);
      console.log(`[worker] ${job.reportId} -> ${finished.status}` +
        (finished.reasons?.length ? ` (${finished.reasons.join('; ')})` : ''));

      // Persist per-claim audit records (Req 6.1). Best-effort: saveAuditRecord swallows
      // its own errors, but we also guard the loop so an audit-persistence failure — or a
      // no_sufficient_evidence claim — can never fail an otherwise-ready report (Req 7.3).
      try {
        for (const record of result.audits) {
          await deps.repo.saveAuditRecord(job.reportId, record);
        }
      } catch (auditErr) {
        console.error(`[worker] ${job.reportId} audit persistence failed (non-fatal):`, auditErr);
      }

      // Only cache servable reports so we never serve a stale 'needs_review' as final.
      if (finished.status === 'ready') {
        await deps.cache.set(job.urlHash, finished);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ${job.reportId} -> failed:`, message);
      await deps.repo.saveReport({
        ...existing,
        status: 'failed',
        error: message,
        updatedAt: new Date().toISOString(),
      });
    }
  };
}
