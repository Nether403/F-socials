// Gemini access — a reusable JSON-completion helper (callGeminiJson) with model
// fallback, plus the LLM extraction provider built on top of it.
// Docs: https://ai.google.dev/api/generate-content

import type { ExtractionResult, LLMProvider, Transcript } from './types';

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface GeminiOpts {
  apiKey: string;
  model: string;
  backupModel?: string;
  timeoutMs?: number;
}

// Low-level single-model call returning the raw response text. When `schema` is
// provided the model is asked for strict JSON (responseMimeType + responseSchema);
// omit it for free-text generation. `system` is sent as a systemInstruction only
// when non-empty. This is the shared HTTP core both the JSON and text helpers build on.
async function callModelText(
  model: string,
  apiKey: string,
  timeoutMs: number,
  system: string,
  userText: string,
  schema?: unknown,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const generationConfig: Record<string, unknown> = { temperature: 0.2 };
  if (schema !== undefined) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let res: Response;
  try {
    res = await fetch(endpoint(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`timed out after ${timeoutMs}ms`);
    throw new Error(`request failed: ${msg(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
  const data = (await res.json()) as any;
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`no content (finishReason=${data?.candidates?.[0]?.finishReason ?? 'no_text'})`);
  return text;
}

// Primary -> backup model fallback shared by the JSON and text helpers: try the
// primary model, then (if configured) the backup, with the same warn/log lines.
async function callWithBackup<T>(opts: GeminiOpts, run: (model: string) => Promise<T>): Promise<T> {
  try {
    return await run(opts.model);
  } catch (primaryErr) {
    if (!opts.backupModel) throw new Error(`Gemini ${opts.model} failed: ${msg(primaryErr)}`);
    console.warn(`[gemini] primary "${opts.model}" failed (${msg(primaryErr)}); trying backup "${opts.backupModel}"`);
    try {
      const r = await run(opts.backupModel);
      console.log(`[gemini] backup "${opts.backupModel}" served the request`);
      return r;
    } catch (backupErr) {
      throw new Error(
        `Gemini both models failed — ${opts.model}: ${msg(primaryErr)} | ${opts.backupModel}: ${msg(backupErr)}`,
      );
    }
  }
}

// Generic JSON completion with primary -> backup model fallback.
export async function callGeminiJson(
  opts: GeminiOpts,
  args: { system: string; userText: string; schema: unknown },
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const text = await callWithBackup(opts, (model) =>
    callModelText(model, opts.apiKey, timeoutMs, args.system, args.userText, args.schema),
  );
  return JSON.parse(text);
}

// Generic free-text completion with primary -> backup model fallback. Returns the
// model's raw text response; the caller parses it. Used by the coaching LLM seam,
// whose engine asks for (and itself parses) a JSON array out of free text.
export async function callGeminiText(opts: GeminiOpts, prompt: string): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  return callWithBackup(opts, (model) => callModelText(model, opts.apiKey, timeoutMs, '', prompt));
}

const EXTRACTION_SYSTEM = `You are f-Socials, a media-literacy analysis engine.
You are a LENS, NOT A JUDGE: you describe how content is constructed; you never declare it true or false.

Given a transcript, return:
1. tldr: a 2-3 sentence neutral, plain-language summary. No verdicts.
2. claims: the distinct VERIFIABLE factual assertions (not opinions, predictions, or pure rhetoric).
   For each: claimText (the assertion), transcriptSpan (the exact quote, verbatim), a verifiability
   rating, your confidence (0..1), and sourceBasis (a brief note on what would verify it).
3. framingSignals: rhetorical techniques used (e.g. "Emotional Language", "Us vs. Them Framing",
   "Selective Emphasis"). For each: technique, severity, a one-line description, and examples — each
   example has the exact quote (text, VERBATIM from the transcript so it can be located) and a calm,
   non-judgmental explanation. Describe the rhetoric; do not moralise. Do NOT invent sources.
4. contextCards: useful context the content omits — each a title + a plain description of what a
   careful reader would want to know. Do NOT fabricate source URLs.
5. issueFrame: x = economic axis (-1 state/left .. +1 market/right), y = social axis
   (-1 libertarian .. +1 authoritarian), plus a short neutral label. Descriptive, not a verdict.

Be forensic and calm. Use the transcript's own words for every quote. Never fabricate citations.`;

const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tldr: { type: 'STRING' },
    issueFrame: {
      type: 'OBJECT',
      properties: { label: { type: 'STRING' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
      required: ['label', 'x', 'y'],
    },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claimText: { type: 'STRING' },
          transcriptSpan: { type: 'STRING' },
          verifiability: { type: 'STRING', enum: ['verifiable', 'partially_verifiable', 'opinion', 'unverifiable'] },
          confidence: { type: 'NUMBER' },
          sourceBasis: { type: 'STRING' },
        },
        required: ['claimText', 'transcriptSpan', 'verifiability', 'confidence'],
      },
    },
    framingSignals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          technique: { type: 'STRING' },
          severity: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          description: { type: 'STRING' },
          examples: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { text: { type: 'STRING' }, explanation: { type: 'STRING' } },
              required: ['text', 'explanation'],
            },
          },
        },
        required: ['technique', 'severity', 'description', 'examples'],
      },
    },
    contextCards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, description: { type: 'STRING' } },
        required: ['title', 'description'],
      },
    },
  },
  required: ['tldr', 'issueFrame', 'claims', 'framingSignals', 'contextCards'],
};

export function makeGeminiLLM(opts: GeminiOpts): LLMProvider {
  return {
    async extract(transcript: Transcript): Promise<ExtractionResult> {
      const parsed = await callGeminiJson(opts, {
        system: EXTRACTION_SYSTEM,
        userText: transcript.text,
        schema: EXTRACTION_SCHEMA,
      });
      return {
        tldr: parsed.tldr ?? '',
        issueFrame: parsed.issueFrame ?? { label: 'unknown', x: 0, y: 0 },
        claims: parsed.claims ?? [],
        framingSignals: parsed.framingSignals ?? [],
        contextCards: parsed.contextCards ?? [],
      };
    },
  };
}
