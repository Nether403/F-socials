// Auth middleware.
//   optionalAuth: no token -> anonymous (proceed); valid token -> req.user set;
//                 present-but-invalid token -> 401 (reject bad tokens).
//   requireAuth:  401 unless req.user is set.

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { verifyJwt, type AuthUser } from '../auth/supabase';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
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
