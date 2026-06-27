// The analysis pipeline: transcript -> extract -> attach evidence -> perspectives -> gate.
// Pure function of (input, providers); easy to test, no infra coupling.

import { randomUUID } from 'node:crypto';
import type { Providers } from '../providers/types';
import type { AuditRecord, Candidate, Claim, ContextCard, FramingSignal, RawInput } from '../types';
import { assembleReport, type AssembleResult } from '../core/assemble';
import { classifyCitationTier } from '../core/sourceTier';
import { verifyClaim, type VerifyDeps } from '../router/index';
import { makeRetrieve } from '../router/retrieve';

export interface PipelineResult extends AssembleResult {
  transcript: string;
  title?: string;
  // Per-claim decision records from the Claim_Verification_Router, one per extracted
  // claim, exposed so the worker can persist them (task 11.2) without re-running.
  audits: AuditRecord[];
  // same_topic_different_claim material the router routed to Useful_Context. Collected
  // here because the served AnalysisReport has no Useful_Context region yet; kept
  // DISTINCT from contextCards so it is never presented as evidence (Req 7.4).
  usefulContext: Candidate[];
}

export async function runPipeline(input: RawInput, providers: Providers): Promise<PipelineResult> {
  // Stage 1: transcript
  const transcript = await providers.transcript.fetch(input);

  // Stage 2: LLM extraction
  const extraction = await providers.llm.extract(transcript);

  // Stage 3: verify each claim through the Claim_Verification_Router (normalize →
  // triage → query pack → retrieve → validate → assemble outcome). This replaces the
  // old first-wins `evidence.gather`: the router cites only candidates that actually
  // match the claim and reports honestly when none do. Deps are built from the
  // providers this pipeline already receives — retrieval wraps the existing chained
  // EvidenceProvider as a single source (the composition root owns provider selection,
  // task 11.3; this only wires the router into the per-claim flow).
  //
  // ponytail: isFactCheck is false because the chained EvidenceProvider does not expose
  // which underlying provider (Google Fact Check vs GDELT/Tavily) produced a citation,
  // so we cannot honestly attribute a matched_fact_check outcome to it. Upgrade path
  // (task 11.3): pass the per-provider list with isFactCheck set on the Google Fact
  // Check source so that outcome can be distinguished.
  const verifyDeps: VerifyDeps = {
    normalizer: providers.normalizer,
    validator: providers.validator,
    retrieve: makeRetrieve({
      sources: [{ provider: providers.evidence, isFactCheck: false }],
      classifyTier: classifyCitationTier,
    }),
    classifyTier: classifyCitationTier,
  };

  const claims: Claim[] = [];
  const audits: AuditRecord[] = [];
  const usefulContext: Candidate[] = [];
  const routerContextCards: ContextCard[] = [];
  for (const c of extraction.claims) {
    const verified = await verifyClaim(c.claimText, verifyDeps);
    claims.push({
      id: randomUUID(),
      claimText: c.claimText,
      transcriptSpan: c.transcriptSpan,
      verifiability: c.verifiability,
      sourceBasis: c.sourceBasis,
      confidence: c.confidence,
      // Strength + citations come straight from the router. Citations are Claim_Ledger
      // evidence ONLY (same_claim / contradictory_but_relevant) and are already
      // tier-classified by retrieval (via classifyCitationTier), so no re-classification
      // is needed here. A no_sufficient_evidence / relevant_context_only /
      // not_fact_checkable outcome carries zero citations, so the honest-none state
      // reaches the gate intact and no non-matching candidate is presented as evidence
      // (Req 7.1, 7.4).
      evidenceStrength: verified.evidenceStrength,
      citations: verified.citations,
    });
    audits.push(verified.audit);
    // relevant_context_only material — surfaced as context, never as a citation (7.2).
    usefulContext.push(...verified.usefulContext);
    routerContextCards.push(...verified.contextCards);
  }

  // Framing signals: locate each example's quote in the transcript for UI highlighting.
  // ponytail: indexOf finds the FIRST occurrence; duplicate quotes resolve to the first.
  const framingSignals: FramingSignal[] = extraction.framingSignals.map((fs) => ({
    technique: fs.technique,
    severity: fs.severity,
    description: fs.description,
    examples: fs.examples.map((ex) => {
      const startIndex = transcript.text.indexOf(ex.text);
      return {
        text: ex.text,
        explanation: ex.explanation,
        startIndex,
        endIndex: startIndex >= 0 ? startIndex + ex.text.length : -1,
      };
    }),
  }));

  // Stage 4: bridging perspectives
  const perspectives = await providers.perspective.find(extraction.tldr);

  // Stage 5: assemble + invariant gate
  const confidence =
    claims.length > 0 ? claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length : 0;

  const assembled = assembleReport({
    tldr: extraction.tldr,
    issueFrame: extraction.issueFrame,
    claims,
    framingSignals,
    // Merge the LLM-extracted omission cards with the router's background_context
    // cards. Both are context the content lacks; neither is Claim_Ledger evidence, so
    // appending here cannot affect the invariant gate (which only checks claims +
    // framing).
    contextCards: [...extraction.contextCards, ...routerContextCards],
    perspectives,
    confidence,
  });

  return {
    ...assembled,
    transcript: transcript.text,
    title: transcript.title,
    audits,
    usefulContext,
  };
}
