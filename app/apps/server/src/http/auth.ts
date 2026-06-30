// Auth middleware.
//   optionalAuth: no token -> anonymous (proceed); valid token -> req.user set;
//                 present-but-invalid token -> 401 (reject bad tokens).
//   requireAuth:  401 unless req.user is set.

import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config';
import { verifyJwt, type AuthUser } from '../auth/supabase';
import type { Repository, RateLimitConfig } from '../infra/ports';

// Resolved Institutional_API key info attached to the request after apiKeyAuth.
// Carries identifiers + the optional per-key rate-limit tier only — never a
// verdict or creator rating (compass).
export interface ApiKeyContext {
  keyId: string;
  institutionId: string;
  rateLimit?: RateLimitConfig;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: ApiKeyContext;
    }
  }
}

const secretBytes = config.supabase.jwtSecret
  ? new TextEncoder().encode(config.supabase.jwtSecret)
  : null;

export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(); // anonymous
    return;
  }
  if (!secretBytes) {
    res.status(401).json({ error: 'auth_not_configured' });
    return;
  }
  try {
    req.user = await verifyJwt(header.slice(7), secretBytes);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'auth_required' });
    return;
  }
  next();
}

// Admits only a Reviewer. Layered after requireAuth, so a missing/invalid token
// has already produced 401 (Req 1.2, 1.3). Here we only decide reviewer-or-not.
export function reviewerGuard(req: Request, res: Response, next: NextFunction): void {
  const role = config.reviewerRole; // '' when unconfigured
  if (!role) {
    // Req 1.6 — fail closed, deny all
    res.status(403).json({ error: 'reviewer_role_not_configured' });
    return;
  }
  if (req.user?.role !== role) {
    // Req 1.4 — authenticated non-reviewer
    res.status(403).json({ error: 'not_a_reviewer' });
    return;
  }
  next(); // Req 1.1
}

// Institutional_API auth — a SEPARATE path from the reader JWT (Req 6.5). Reads the
// Authorization header (`Bearer <key>` or the bare key), SHA-256 hashes the presented
// value (hex, matching how createApiKey persists it), and looks it up. A missing,
// malformed, revoked, or unknown key => 401 with no query executed and no rate count
// (Req 6.2, 6.3, 8.7). On success, attaches the resolved key info and proceeds.
export function apiKeyAuth(repo: Repository): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : header?.trim();
    if (!presented) {
      res.status(401).json({ error: 'api_key_required' });
      return;
    }
    const hash = createHash('sha256').update(presented).digest('hex');
    const key = await repo.findApiKeyByHash(hash);
    if (!key) {
      res.status(401).json({ error: 'invalid_api_key' });
      return;
    }
    req.apiKey = key;
    next();
  };
}
