// verifyJwt accepts a properly-signed token and rejects tampered, expired, or
// wrong-secret tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { verifyJwt } from '../src/auth/supabase';

const secret = new TextEncoder().encode('test-secret-test-secret-test-secret-123');
const wrongSecret = new TextEncoder().encode('a-different-secret-a-different-secret-xx');

function sign(payload: Record<string, unknown>, exp = '1h') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);
}

test('verifies a valid token and extracts the user', async () => {
  const token = await sign({ sub: 'user-123', email: 'a@b.com', role: 'authenticated' });
  const user = await verifyJwt(token, secret);
  assert.equal(user.id, 'user-123');
  assert.equal(user.email, 'a@b.com');
  assert.equal(user.role, 'authenticated');
});

test('rejects a token signed with a different secret', async () => {
  const token = await sign({ sub: 'user-123' });
  await assert.rejects(() => verifyJwt(token, wrongSecret));
});

test('rejects an expired token', async () => {
  const token = await new SignJWT({ sub: 'user-123' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(secret);
  await assert.rejects(() => verifyJwt(token, secret));
});

test('rejects a token with no subject', async () => {
  const token = await sign({ email: 'a@b.com' });
  await assert.rejects(() => verifyJwt(token, secret));
});
