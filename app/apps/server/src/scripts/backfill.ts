// Backfill_Command (Requirements 8.1–8.5).
//
// One-shot, direct-invocation module (run via `tsx`, mirroring benchmark/runner.ts):
// populate Normalized_Rows for reports that were persisted before the dual-write
// landed (JSONB only). It reuses the repository's idempotent dual-write — backfill
// and live writes can never drift — so the entire job is "load each report and
// re-save it":
//
//   - listReportIds() enumerates every persisted report.
//   - hasReportGraph(id) skips reports that already have Normalized_Rows (Req 8.3),
//     so re-running is idempotent and creates no duplicates (Req 8.2).
//   - saveReport(report) reuses the idempotent dual-write to project the JSONB
//     payload into rows (Req 8.1). It reads the JSONB payload only and never mutates
//     analysis_reports.data (Req 8.4) — saveReport re-writes the same payload.
//   - a per-report failure is caught, its report_id recorded, and the loop continues
//     with the remaining reports (Req 8.5).

import { fileURLToPath } from 'node:url';
import type { Repository } from '../infra/ports';

export interface BackfillSummary {
  processed: number; // reports that had no rows and were populated
  skipped: number; // reports that already had Normalized_Rows
  failed: string[]; // report_ids that threw and were skipped
}

// Backfill every JSONB-only report into the normalized tables. Pure orchestration
// over the injected Repository — no I/O of its own beyond the repo calls — so it is
// driver-agnostic (memory or Postgres) and directly testable.
export async function backfill(repo: Repository): Promise<BackfillSummary> {
  const ids = await repo.listReportIds();
  const summary: BackfillSummary = { processed: 0, skipped: 0, failed: [] };

  for (const id of ids) {
    try {
      // Already populated → skip; this is what makes a re-run create no duplicates.
      if (await repo.hasReportGraph(id)) {
        summary.skipped++;
        continue;
      }
      const report = await repo.getReport(id);
      if (!report) {
        // Listed but unreadable: record and continue (Req 8.5).
        summary.failed.push(id);
        continue;
      }
      // Reuse the idempotent dual-write; reads + re-writes the same JSONB payload,
      // never mutating it (Req 8.1, 8.4).
      await repo.saveReport(report);
      summary.processed++;
    } catch {
      // A single report's failure never aborts the run (Req 8.5).
      summary.failed.push(id);
    }
  }

  return summary;
}

// Direct invocation: `node --import tsx src/scripts/backfill.ts`. Composes the same
// repository the API/worker use (buildContext reuses selectRepo), runs the backfill,
// logs the summary, and exits (the PG/Redis pools would otherwise keep the process
// alive). Runs only when invoked directly, mirroring runner.ts.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { buildContext } = await import('../compose');
  const { repo } = buildContext();
  const summary = await backfill(repo);
  console.log(
    `[backfill] done — processed=${summary.processed} skipped=${summary.skipped} ` +
      `failed=${summary.failed.length}${summary.failed.length ? ` (${summary.failed.join(', ')})` : ''}`,
  );
  process.exit(summary.failed.length > 0 ? 1 : 0);
}
