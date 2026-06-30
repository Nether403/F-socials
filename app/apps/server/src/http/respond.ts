// Outbound neutrality boundary — the last backstop before a payload leaves the
// process. Withholds entirely on guard failure (no partial delivery). Req 15.7.

import type { Response } from 'express';
import { neutralityGuard } from '../infra/telemetry/neutrality';

export function sendNeutral(res: Response, status: number, payload: unknown): void {
  const result = neutralityGuard(payload);
  if (result.pass) {
    res.status(status).json(payload);
  } else {
    // ponytail: withhold = 404 (treated as "no overlay" / "not found") per design.
    // Upgrade path: structured error code per-capability if needed.
    res.status(404).json({ error: 'not_found' });
  }
}
