// Supabase JWT verification. Supabase issues HS256 access tokens signed with the
// project's JWT secret; we verify signature + expiry and extract the user.
//
// ponytail: HS256 with the shared secret matches the current Supabase default and
// the configured SUPABASE_JWT_SECRET. If the project later switches to asymmetric
// "JWT signing keys", swap to a JWKS verifier (jose.createRemoteJWKSet against
// `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`).

import { jwtVerify } from 'jose';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

// Pure + testable: verify a token against a secret, return the user or throw.
export async function verifyJwt(token: string, secret: Uint8Array): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  if (!payload.sub) throw new Error('token missing sub');
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    role: typeof payload.role === 'string' ? payload.role : undefined,
  };
}
