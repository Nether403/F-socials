import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDraft, type LLMProvider } from '../src/core/coaching';

function mockLlm(response: string | (() => Promise<string>)): LLMProvider {
  return {
    analyze: typeof response === 'function' ? response : async () => response,
  };
}

describe('coaching: analyzeDraft', () => {
  it('returns noIssues=true when LLM returns empty array', async () => {
    const r = await analyzeDraft('Hello world', { llm: mockLlm('[]') });
    assert.deepEqual(r, { issues: [], noIssues: true });
  });

  it('parses framing + unsupported_claim issues', async () => {
    const issues = [
      { kind: 'framing', technique: 'Emotional Language', quote: 'terrible', explanation: 'Could be perceived as loaded', suggestion: 'You might consider neutral phrasing' },
      { kind: 'unsupported_claim', quote: 'Studies show', explanation: 'No source identified', suggestion: 'Consider adding a citation' },
    ];
    const r = await analyzeDraft('Some draft', { llm: mockLlm(JSON.stringify(issues)) });
    assert.equal(r.noIssues, false);
    assert.equal(r.issues.length, 2);
    const [first, second] = r.issues;
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.kind, 'framing');
    assert.equal(first.technique, 'Emotional Language');
    assert.equal(second.kind, 'unsupported_claim');
    assert.equal(second.technique, undefined);
  });

  it('gracefully returns empty on LLM error (never throws)', async () => {
    const r = await analyzeDraft('Draft', { llm: mockLlm(async () => { throw new Error('timeout'); }) });
    assert.deepEqual(r, { issues: [], noIssues: true });
  });

  it('caps at 20 issues', async () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({
      kind: 'framing', technique: `T${i}`, quote: 'q', explanation: 'e', suggestion: 's',
    }));
    const r = await analyzeDraft('Draft', { llm: mockLlm(JSON.stringify(issues)) });
    assert.equal(r.issues.length, 20);
  });

  it('truncates quotes longer than 300 chars with ellipsis', async () => {
    const longQuote = 'x'.repeat(500);
    const issues = [{ kind: 'framing', technique: 'T', quote: longQuote, explanation: 'e', suggestion: 's' }];
    const r = await analyzeDraft('Draft', { llm: mockLlm(JSON.stringify(issues)) });
    const [first] = r.issues;
    assert.ok(first);
    assert.equal(first.quote.length, 300);
    assert.ok(first.quote.endsWith('\u2026'));
  });

  it('gracefully returns empty on invalid JSON', async () => {
    const r = await analyzeDraft('Draft', { llm: mockLlm('not json') });
    assert.deepEqual(r, { issues: [], noIssues: true });
  });

  it('handles markdown-wrapped JSON response', async () => {
    const wrapped = '```json\n[{"kind":"framing","technique":"Appeal","quote":"Experts say","explanation":"Could be perceived as appeal","suggestion":"You might cite sources"}]\n```';
    const r = await analyzeDraft('Draft', { llm: mockLlm(wrapped) });
    assert.equal(r.noIssues, false);
    assert.equal(r.issues.length, 1);
    const [first] = r.issues;
    assert.ok(first);
    assert.equal(first.technique, 'Appeal');
  });

  it('skips items with invalid kind', async () => {
    const issues = [
      { kind: 'invalid', quote: 'q', explanation: 'e', suggestion: 's' },
      { kind: 'framing', technique: 'T', quote: 'q', explanation: 'e', suggestion: 's' },
    ];
    const r = await analyzeDraft('Draft', { llm: mockLlm(JSON.stringify(issues)) });
    assert.equal(r.issues.length, 1);
    const [first] = r.issues;
    assert.ok(first);
    assert.equal(first.kind, 'framing');
  });

  it('skips items missing required fields', async () => {
    const issues = [
      { kind: 'framing', quote: 'q', explanation: 'e' }, // missing suggestion
      { kind: 'framing', quote: '', explanation: 'e', suggestion: 's' }, // empty quote
      { kind: 'framing', technique: 'OK', quote: 'valid', explanation: 'e', suggestion: 's' },
    ];
    const r = await analyzeDraft('Draft', { llm: mockLlm(JSON.stringify(issues)) });
    assert.equal(r.issues.length, 1);
    const [first] = r.issues;
    assert.ok(first);
    assert.equal(first.technique, 'OK');
  });

  it('returns empty for non-array JSON response', async () => {
    const r = await analyzeDraft('Draft', { llm: mockLlm('{"foo": "bar"}') });
    assert.deepEqual(r, { issues: [], noIssues: true });
  });

  it('does not attach technique field for unsupported_claim', async () => {
    const issues = [{ kind: 'unsupported_claim', technique: 'should-be-ignored', quote: 'q', explanation: 'e', suggestion: 's' }];
    const r = await analyzeDraft('Draft', { llm: mockLlm(JSON.stringify(issues)) });
    const [first] = r.issues;
    assert.ok(first);
    assert.equal(first.technique, undefined);
  });
});
