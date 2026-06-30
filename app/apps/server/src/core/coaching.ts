// Creator pre-publish coaching engine — pure, stateless, advisory-only.
// Holds NO Repository/Queue/Telemetry handle — cannot persist anything.
// Never feeds the pipeline — no reference to assembleReport or analysis queue.
// Uses advisory phrasing only; never imperative/blocking language.

export interface CoachingIssue {
  kind: 'framing' | 'unsupported_claim';
  technique?: string;            // framing only
  quote: string;                 // <=300 chars
  explanation: string;           // advisory phrasing only
  suggestion: string;            // advisory phrasing only
}

export interface CoachingResponse {
  issues: CoachingIssue[];       // <=20 items
  noIssues: boolean;
}

/** Minimal LLM interface local to this module — text in, text out. */
export interface LLMProvider {
  analyze(prompt: string): Promise<string>;
}

const MAX_ISSUES = 20;
const MAX_QUOTE_LENGTH = 300;

const SYSTEM_PROMPT = `You are a writing coach that helps creators improve their drafts before publishing.
You are advisory only — you NEVER block publishing, issue verdicts, or rate the creator.

Analyze the draft for:
1. Framing techniques: emotional language, loaded terms, false balance, appeal to authority without evidence, selective emphasis, us-vs-them framing, etc.
2. Unsupported claims: assertions presented as fact without sources, citations, or evidence.

For each issue found, respond with a JSON array of objects. Each object has:
- "kind": either "framing" or "unsupported_claim"
- "technique": (framing only) the name of the technique detected
- "quote": the relevant text span from the draft (max 300 characters)
- "explanation": why this could be perceived as an issue (use advisory language: "this could be perceived as", "readers might interpret this as")
- "suggestion": an alternative approach (use advisory language: "you might consider", "consider rephrasing to")

RULES:
- Return at most 20 issues.
- Use ONLY advisory language in explanations and suggestions ("consider", "you might", "this could be perceived as").
- NEVER use imperative language ("you must", "do not", "fix this", "change this").
- NEVER issue truth verdicts — frame issues as technique presence or evidence absence.
- NEVER rate or label the creator.
- If no issues are found, return an empty array [].

Respond with ONLY a JSON array, no other text.`;

function truncateQuote(quote: string): string {
  if (quote.length <= MAX_QUOTE_LENGTH) return quote;
  return quote.slice(0, MAX_QUOTE_LENGTH - 1) + '…';
}

function isValidKind(v: unknown): v is 'framing' | 'unsupported_claim' {
  return v === 'framing' || v === 'unsupported_claim';
}

function parseIssue(raw: unknown): CoachingIssue | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (!isValidKind(obj.kind)) return null;
  if (typeof obj.quote !== 'string' || !obj.quote) return null;
  if (typeof obj.explanation !== 'string' || !obj.explanation) return null;
  if (typeof obj.suggestion !== 'string' || !obj.suggestion) return null;
  // A framing issue is only well-formed when it names the technique it detected
  // (the technique is the framing issue's defining field). Drop framing issues
  // that omit it rather than emit a malformed, technique-less framing issue.
  if (obj.kind === 'framing' && (typeof obj.technique !== 'string' || !obj.technique)) return null;

  const issue: CoachingIssue = {
    kind: obj.kind,
    quote: truncateQuote(obj.quote),
    explanation: obj.explanation,
    suggestion: obj.suggestion,
  };

  if (obj.kind === 'framing' && typeof obj.technique === 'string' && obj.technique) {
    issue.technique = obj.technique;
  }

  return issue;
}

function parseLLMResponse(raw: string): CoachingIssue[] {
  // Strip markdown code fences if present
  let text = raw.trim();
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n');
    text = text.slice(firstNewline + 1);
    const lastFence = text.lastIndexOf('```');
    if (lastFence >= 0) text = text.slice(0, lastFence);
    text = text.trim();
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];

  const issues: CoachingIssue[] = [];
  for (const item of parsed) {
    if (issues.length >= MAX_ISSUES) break;
    const issue = parseIssue(item);
    if (issue) issues.push(issue);
  }
  return issues;
}

export async function analyzeDraft(
  draft: string,
  deps: { llm: LLMProvider },
): Promise<CoachingResponse> {
  try {
    const prompt = `${SYSTEM_PROMPT}\n\n--- DRAFT ---\n${draft}\n--- END DRAFT ---`;
    const response = await deps.llm.analyze(prompt);
    const issues = parseLLMResponse(response);
    return { issues, noIssues: issues.length === 0 };
  } catch {
    // ponytail: graceful degradation — parsing/LLM errors return empty, never throw
    return { issues: [], noIssues: true };
  }
}
