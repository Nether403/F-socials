// Feature: intervention-and-scale, Property 19: Coaching responses are well-formed, honest, and advisory
// Feature: intervention-and-scale, Property 20: Coaching persists nothing
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 11.1, 11.4, 11.5, 11.6, 13.5, 15.4

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { analyzeDraft, type CoachingResponse, type LLMProvider } from '../src/core/coaching';

const MAX_ISSUES = 20;
const MAX_QUOTE_LENGTH = 300;
const VALID_KINDS = new Set(['framing', 'unsupported_claim']);

// Imperative / blocking phrases that advisory coaching output must NEVER contain.
const BANNED_PHRASES = ['you must', 'do not', 'fix this', 'change this', 'block', 'prevent'];

// ---------------------------------------------------------------------------
// Generators — every emitted string is advisory/benign by construction so that
// the ONLY way banned wording could appear in the output is an engine defect.
// ---------------------------------------------------------------------------

// Advisory phrasings the engine is responsible for; none contain a banned phrase.
const advisory = fc.constantFrom(
  'this could be perceived as loaded language',
  'readers might interpret this as one-sided',
  'you might consider rephrasing for neutrality',
  'consider adding a supporting citation',
  'this could be seen as emphasizing a single perspective',
  'consider whether a source supports this assertion',
  'readers could read this as an appeal to authority',
);

// Framing technique labels (framing-only field).
const technique = fc.constantFrom(
  'Emotional Language',
  'Loaded Terms',
  'False Balance',
  'Appeal to Authority',
  'Selective Emphasis',
  'Us-vs-Them Framing',
);

// Benign quote text built from safe words (no banned substrings).
const safeWord = fc.constantFrom(
  'the', 'market', 'grew', 'rapidly', 'experts', 'said', 'data', 'shows',
  'many', 'people', 'believe', 'study', 'reported', 'sources', 'suggests',
  'context', 'readers', 'perspective', 'claim', 'evidence',
);
const safeQuote = fc.array(safeWord, { minLength: 1, maxLength: 12 }).map((w) => w.join(' '));

// A well-formed framing issue (carries technique).
const validFramingIssue = fc.record({
  kind: fc.constant('framing'),
  technique,
  quote: safeQuote,
  explanation: advisory,
  suggestion: advisory,
});

// A well-formed unsupported_claim issue (no technique).
const validUnsupportedIssue = fc.record({
  kind: fc.constant('unsupported_claim'),
  quote: safeQuote,
  explanation: advisory,
  suggestion: advisory,
});

// Accepted-but-bounded: an overlong quote (>300 chars) the engine must truncate.
// Padding is 'x' (no banned substring).
const overlongIssue = fc.record({
  kind: fc.constant('framing'),
  technique,
  quote: fc.integer({ min: 301, max: 1200 }).map((n) => 'x'.repeat(n)),
  explanation: advisory,
  suggestion: advisory,
});

// Malformed items the engine must reject entirely.
const malformedItem = fc.oneof(
  // invalid kind
  fc.record({ kind: fc.constant('verdict'), quote: safeQuote, explanation: advisory, suggestion: advisory }),
  // framing missing its technique
  fc.record({ kind: fc.constant('framing'), quote: safeQuote, explanation: advisory, suggestion: advisory }),
  // missing suggestion
  fc.record({ kind: fc.constant('framing'), technique, quote: safeQuote, explanation: advisory }),
  // empty quote
  fc.record({ kind: fc.constant('unsupported_claim'), quote: fc.constant(''), explanation: advisory, suggestion: advisory }),
  // non-object items
  fc.constant(null),
  fc.integer(),
  fc.constant('a stray string item'),
);

const anyItem = fc.oneof(validFramingIssue, validUnsupportedIssue, overlongIssue, malformedItem);

// The raw LLM response string. Covers: large arrays (>20), markdown-wrapped JSON,
// non-array JSON, and non-JSON garbage.
const llmResponse = fc.oneof(
  fc.array(anyItem, { maxLength: 40 }).map((items) => JSON.stringify(items)),
  fc.array(anyItem, { maxLength: 40 }).map((items) => '```json\n' + JSON.stringify(items) + '\n```'),
  fc.constantFrom('{"not":"an array"}', '42', '"plain string"'),
  fc.constantFrom('not json at all', '<<<garbage>>>', 'undefined', '{oops', '[unterminated'),
);

function mockLlm(response: string): LLMProvider {
  return { analyze: async () => response };
}

function assertWellFormed(r: CoachingResponse): void {
  // <=20 issues (Req 10.1)
  assert.ok(r.issues.length <= MAX_ISSUES, `expected <=${MAX_ISSUES} issues, got ${r.issues.length}`);
  // noIssues mirrors emptiness exactly (Req 10.4)
  assert.equal(r.noIssues, r.issues.length === 0);

  for (const issue of r.issues) {
    assert.ok(VALID_KINDS.has(issue.kind), `invalid kind: ${issue.kind}`);
    // quote present and bounded (Req 10.2, 10.3)
    assert.equal(typeof issue.quote, 'string');
    assert.ok(issue.quote.length > 0, 'quote must be non-empty');
    assert.ok(issue.quote.length <= MAX_QUOTE_LENGTH, `quote too long: ${issue.quote.length}`);
    // advisory fields present (Req 11.4)
    assert.equal(typeof issue.explanation, 'string');
    assert.ok(issue.explanation.length > 0);
    assert.equal(typeof issue.suggestion, 'string');
    assert.ok(issue.suggestion.length > 0);

    if (issue.kind === 'framing') {
      // framing carries a technique (Req 11.1)
      assert.equal(typeof issue.technique, 'string');
      assert.ok((issue.technique ?? '').length > 0, 'framing issue must carry a technique');
    } else {
      // unsupported_claim carries no technique
      assert.equal(issue.technique, undefined);
    }
  }
}

describe('Property 19: Coaching responses are well-formed, honest, and advisory', () => {
  it('produces bounded, well-formed output for any (adversarial) LLM response', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), llmResponse, async (draft, response) => {
        const r = await analyzeDraft(draft, { llm: mockLlm(response) });
        assertWellFormed(r);
      }),
      { numRuns: 200 },
    );
  });

  it('emits no imperative/blocking wording anywhere in the output', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), llmResponse, async (draft, response) => {
        const r = await analyzeDraft(draft, { llm: mockLlm(response) });
        const serialized = JSON.stringify(r).toLowerCase();
        for (const banned of BANNED_PHRASES) {
          assert.ok(
            !serialized.includes(banned),
            `output must not contain imperative/blocking phrase "${banned}"`,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('caps at 20 issues even when many valid issues are returned', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(validFramingIssue, validUnsupportedIssue), { minLength: 21, maxLength: 60 }),
        async (issues) => {
          const r = await analyzeDraft('draft', { llm: mockLlm(JSON.stringify(issues)) });
          assert.equal(r.issues.length, MAX_ISSUES);
          assert.equal(r.noIssues, false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('truncates overlong quotes to the 300-char bound', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 301, max: 2000 }), async (n) => {
        const issue = { kind: 'framing', technique: 'Loaded Terms', quote: 'x'.repeat(n), explanation: 'this could be perceived as loaded language', suggestion: 'you might consider rephrasing for neutrality' };
        const r = await analyzeDraft('draft', { llm: mockLlm(JSON.stringify([issue])) });
        const [only] = r.issues;
        assert.ok(only);
        assert.equal(only.quote.length, MAX_QUOTE_LENGTH);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 20: Coaching persists nothing', () => {
  it('touches only the llm seam — no other dependency is read', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (draft) => {
        const accessed = new Set<string>();
        const llm: LLMProvider = { analyze: async () => '[]' };
        // Proxy records every property read on the deps object: analyzeDraft must
        // reach for nothing but `llm` (no repo / queue / telemetry handle exists).
        const deps = new Proxy({ llm }, {
          get(target, prop, receiver) {
            if (typeof prop === 'string') accessed.add(prop);
            return Reflect.get(target, prop, receiver);
          },
        });
        await analyzeDraft(draft, deps);
        assert.deepEqual([...accessed], ['llm'], 'analyzeDraft must read only deps.llm');
      }),
      { numRuns: 100 },
    );
  });

  it('invokes llm.analyze exactly once and returns only a CoachingResponse', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), llmResponse, async (draft, response) => {
        let calls = 0;
        const llm: LLMProvider = {
          analyze: async () => {
            calls += 1;
            return response;
          },
        };
        const r = await analyzeDraft(draft, { llm });

        assert.equal(calls, 1, 'llm.analyze must be called exactly once');
        // Output is a pure CoachingResponse — no report or persisted-id surface.
        assert.deepEqual(new Set(Object.keys(r)), new Set(['issues', 'noIssues']));
        assert.equal('report' in (r as unknown as Record<string, unknown>), false);
        assert.equal('id' in (r as unknown as Record<string, unknown>), false);
      }),
      { numRuns: 100 },
    );
  });

  it('never writes the draft (or any content) to a log', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), llmResponse, async (draft, response) => {
        const captured: string[] = [];
        const originals = methods.map((m) => console[m]);
        for (const m of methods) {
          // eslint-disable-next-line no-console
          console[m] = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
        }
        try {
          await analyzeDraft(draft, { llm: mockLlm(response) });
        } finally {
          methods.forEach((m, i) => { console[m] = originals[i]!; });
        }
        const log = captured.join('\n');
        assert.ok(!log.includes(draft), 'the draft text must never appear in any log');
        assert.equal(captured.length, 0, 'analyzeDraft must not log anything');
      }),
      { numRuns: 100 },
    );
  });
});
