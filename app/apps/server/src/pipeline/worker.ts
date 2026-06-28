// The worker: consumes jobs, runs the pipeline, persists the report, caches ready ones.

import { randomUUID } from 'node:crypto';
import type { Providers } from '../providers/types';
import type { Cache, Job, Repository, Telemetry } from '../infra/ports';
import type { AnalysisReport, AuditRecord, EvidenceOutcome } from '../types';
import { runPipeline } from './stages';
import { assertInvariantGateIntact } from '../router/guard';
import { citationCoverage } from '../core/kpi';
import { config } from '../config';

function shortSlug(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

// The active provider categories an error can be attributed to (Req 4.3). `unknown`
// is the explicit fallback — never an omitted field, never a Denied_Field value.
export type ProviderCategory = 'llm' | 'evidence' | 'perspective' | 'transcript' | 'unknown';

export interface ErrorContext {
  reportId: string;
  stage: string;
  providerCategory: ProviderCategory;
  // Index signature so the context is directly assignable to the Telemetry.capture
  // `Record<string, unknown>` parameter; every value is a string.
  [key: string]: string;
}

const PROVIDER_CATEGORIES: ReadonlySet<string> = new Set<ProviderCategory>([
  'llm',
  'evidence',
  'perspective',
  'transcript',
  'unknown',
]);

// Pure, total error-context builder (Property 11; Req 4.3, 4.7). Always returns an
// object carrying all three keys: a field that cannot be determined from the partial
// input is set to the literal string 'unknown' rather than omitted, and that literal
// is never a Denied_Field value. A non-empty string `reportId`/`stage` passes through;
// `providerCategory` passes through only when it is one of the five known categories,
// otherwise it collapses to 'unknown'.
export function buildErrorContext(partial?: {
  reportId?: unknown;
  stage?: unknown;
  providerCategory?: unknown;
}): ErrorContext {
  const known = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v : undefined;
  const pc = partial?.providerCategory;
  return {
    reportId: known(partial?.reportId) ?? 'unknown',
    stage: known(partial?.stage) ?? 'unknown',
    providerCategory:
      typeof pc === 'string' && PROVIDER_CATEGORIES.has(pc) ? (pc as ProviderCategory) : 'unknown',
  };
}

// The six defined Evidence_Outcome categories, used to seed the outcome distribution
// with explicit zeros so every category is always present (Req 9.3).
const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = [
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
];

// One non-negative integer count per defined Evidence_Outcome (Req 9.3). Out-of-enum
// outcomes are ignored so the distribution only ever carries the six known categories.
function outcomeDistribution(
  audits: ReadonlyArray<Pick<AuditRecord, 'evidenceOutcome'>>,
): Record<EvidenceOutcome, number> {
  const dist = Object.fromEntries(EVIDENCE_OUTCOMES.map((o) => [o, 0])) as Record<
    EvidenceOutcome,
    number
  >;
  for (const { evidenceOutcome } of audits) {
    if (Object.prototype.hasOwnProperty.call(dist, evidenceOutcome)) dist[evidenceOutcome]++;
  }
  return dist;
}

export function makeWorker(deps: {
  repo: Repository;
  cache: Cache;
  telemetry: Telemetry;
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
      const startedAt = Date.now();
      const result = await runPipeline(job.input, deps.providers, config.concurrencyCap);
      // Date.now() around runPipeline: a non-negative integer count of milliseconds
      // (clamped in case a wall-clock adjustment runs it backwards). Measured AFTER
      // runPipeline returns; nothing is emitted on the gate path (Req 9.2, 11.5).
      const durationMs = Math.max(0, Date.now() - startedAt);
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

      // Product_Analytics: one pipeline_complete event AFTER the run completes (never
      // on the gate path — Req 11.5). Carries only ids and metrics: the resulting
      // status label, the end-to-end duration as a non-negative integer of ms, one
      // non-negative count per Evidence_Outcome, and the report's Citation_Coverage
      // ratio in [0,1] (Req 9.2, 9.3). Fire-and-forget/fail-open: emit is synchronous
      // void and a telemetry fault never reaches the pipeline (Req 11.7).
      deps.telemetry.emit('pipeline_complete', {
        reportId: job.reportId,
        status: finished.status,
        durationMs,
        outcomeDistribution: outcomeDistribution(result.audits),
        citationCoverage: citationCoverage(result.audits),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ${job.reportId} -> failed:`, message);
      // Error_Monitor: capture the pipeline failure exactly once with structured
      // context (Req 4.2, 4.3, 4.7). reportId is known here; stage/providerCategory
      // are not attributable at the catch boundary, so they collapse to 'unknown'.
      // This is purely additive — the failed persist below (status/error) is unchanged
      // (Req 4.5).
      deps.telemetry.capture(err, buildErrorContext({ reportId: job.reportId }));
      await deps.repo.saveReport({
        ...existing,
        status: 'failed',
        error: message,
        updatedAt: new Date().toISOString(),
      });
    }
  };
}
