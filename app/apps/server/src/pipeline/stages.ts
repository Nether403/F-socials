// The analysis pipeline: transcript -> extract -> attach evidence -> perspectives -> gate.
// Pure function of (input, providers); easy to test, no infra coupling.

import { randomUUID } from 'node:crypto';
import type { Providers } from '../providers/types';
import type { Claim, FramingSignal, RawInput } from '../types';
import { assembleReport, type AssembleResult } from '../core/assemble';

export interface PipelineResult extends AssembleResult {
  transcript: string;
  title?: string;
}

export async function runPipeline(input: RawInput, providers: Providers): Promise<PipelineResult> {
  // Stage 1: transcript
  const transcript = await providers.transcript.fetch(input);

  // Stage 2: LLM extraction
  const extraction = await providers.llm.extract(transcript);

  // Stage 3: attach evidence per claim
  const claims: Claim[] = [];
  for (const c of extraction.claims) {
    const ev = await providers.evidence.gather(c.claimText);
    claims.push({
      id: randomUUID(),
      claimText: c.claimText,
      transcriptSpan: c.transcriptSpan,
      verifiability: c.verifiability,
      sourceBasis: c.sourceBasis,
      confidence: c.confidence,
      evidenceStrength: ev.evidenceStrength,
      citations: ev.citations,
    });
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
    contextCards: extraction.contextCards,
    perspectives,
    confidence,
  });

  return { ...assembled, transcript: transcript.text, title: transcript.title };
}
