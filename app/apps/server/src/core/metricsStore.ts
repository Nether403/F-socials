// Metrics_Store — builds the live TrustMetrics by feeding already-persisted
// evidence outcomes and human signals through the existing pure KPI functions.
// No new metric math. Offline (empty data) → coverage = 0, agreement = undefined
// → gate not satisfied (fail-closed, Req 14.6). Never mutates the audits.

import type { Repository } from '../infra/ports';
import type { TrustMetrics } from './trustGate';
import { citationCoverage, modelHumanAgreement } from './kpi';

export async function buildTrustMetrics(deps: { repo: Repository }): Promise<TrustMetrics> {
  const outcomes = await deps.repo.listEvidenceOutcomes();
  const signals = await deps.repo.listHumanSignals();

  // citationCoverage expects objects with `evidenceOutcome`; outcomes already have it.
  const coverage = citationCoverage(outcomes);

  // modelHumanAgreement expects ModelOutcome[] (reportId, claimId, outcome).
  const modelOutcomes = outcomes.map((o) => ({
    reportId: o.reportId,
    claimId: o.claimId,
    outcome: o.evidenceOutcome,
  }));
  const agreement = modelHumanAgreement(modelOutcomes, signals);

  return { citationCoverage: coverage, modelHumanAgreement: agreement };
}
