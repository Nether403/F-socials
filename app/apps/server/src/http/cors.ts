// CORS as an origin decision (Requirements 5.7, 5.8).
//
// The decision is a pure, side-effect-free predicate so it can be property-tested
// in isolation (Property 15). The middleware below applies it to real requests.

import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Pure predicate: should a request with this Origin header be allowed to proceed?
//
//   - Origin matches the configured origin            → allow (cross-origin, ACAO will be set)
//   - Origin present but does NOT match               → deny  (403, no ACAO, resource withheld)
//   - Origin absent (same-origin request, no header)  → allow (CORS does not apply)
//
// Proceeds for a *cross-origin* request if and only if its origin equals the
// configured origin; same-origin requests carry no Origin header and are unaffected.
export function allowOrigin(requestOrigin: string | undefined, configuredOrigin: string): boolean {
  if (requestOrigin === undefined) return true; // same-origin: no Origin header, CORS not engaged
  return requestOrigin === configuredOrigin;
}

// Middleware factory. Echoes the request's own origin into Access-Control-Allow-Origin
// only when it matches the configured origin; a present-but-mismatched origin is rejected
// with 403 and no ACAO header so the resource is withheld from that origin.
export function corsMiddleware(configuredOrigin: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestOrigin = req.headers.origin; // string | undefined

    if (!allowOrigin(requestOrigin, configuredOrigin)) {
      // Present but mismatched origin → reject, do not return the resource (5.8).
      res.status(403).json({ error: 'cors_origin_denied' });
      return;
    }

    res.setHeader('Vary', 'Origin');
    if (requestOrigin !== undefined) {
      // Matched cross-origin request: apply its origin as the allowed origin (5.7).
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
