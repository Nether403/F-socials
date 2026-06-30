import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '../src/infra/memory';

// Feature: intervention-and-scale — example/edge test for the ≤10 active-key limit.
// Validates: Requirements 6.7 (an institution may hold at most 10 active API keys;
// the 11th creation is rejected and persists no new key; revoking one frees a slot).
describe('intervention: active API-key limit (Req 6.7)', () => {
  it('allows 10 active keys, rejects the 11th without persisting, and frees a slot on revoke', async () => {
    const repo = new InMemoryRepository();
    const institutionId = 'inst-limit';

    // Ten active keys all succeed.
    const created: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { keyId } = await repo.createApiKey(institutionId);
      created.push(keyId);
    }
    assert.equal(await repo.countActiveApiKeys(institutionId), 10, 'ten keys are active');

    // The 11th is rejected (createApiKey throws ActiveKeyLimit) and nothing is persisted.
    await assert.rejects(
      () => repo.createApiKey(institutionId),
      /ActiveKeyLimit/,
      'the 11th creation is rejected',
    );
    assert.equal(
      await repo.countActiveApiKeys(institutionId),
      10,
      'no new key persisted after the rejected 11th creation',
    );

    // Revoking one key frees a slot, so a fresh creation succeeds.
    await repo.revokeApiKey(created[0]!);
    assert.equal(await repo.countActiveApiKeys(institutionId), 9, 'revoke drops the active count');

    const replacement = await repo.createApiKey(institutionId);
    assert.ok(replacement.keyId, 'creation succeeds once a slot is freed');
    assert.equal(await repo.countActiveApiKeys(institutionId), 10, 'back to ten active keys');
  });

  it('scopes the limit per institution', async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 10; i++) await repo.createApiKey('inst-a');

    // A different institution is unaffected by inst-a being at its limit.
    const other = await repo.createApiKey('inst-b');
    assert.ok(other.keyId, 'a second institution can still create keys');
    assert.equal(await repo.countActiveApiKeys('inst-a'), 10);
    assert.equal(await repo.countActiveApiKeys('inst-b'), 1);
  });
});
