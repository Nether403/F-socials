// Input validation at the trust boundary. zod rejects malformed/oversized input
// before it ever reaches the pipeline or any paid provider.

import { z } from 'zod';

import { RESOLUTION_OUTCOMES } from '../core/reviewOutcome';

export const submitSchema = z
  .object({
    sourceType: z.enum(['youtube', 'article', 'transcript']),
    url: z.string().url().max(2048).optional(),
    transcript: z.string().min(1).max(20000).optional(),
  })
  .refine((d) => (d.sourceType === 'transcript' ? !!d.transcript : !!d.url), {
    message: "Provide 'transcript' for transcript inputs, otherwise a 'url'.",
  });

export type SubmitInput = z.infer<typeof submitSchema>;

export const disputeSchema = z.object({
  reason: z.string().min(1).max(2000),
  claimId: z.string().max(200).optional(),
});

export type DisputeInput = z.infer<typeof disputeSchema>;

export const flagSchema = z.object({
  technique: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

export type FlagInput = z.infer<typeof flagSchema>;

// Review queue filter (Req 2.5): optional status narrows the queue listing.
export const reviewQueueQuerySchema = z.object({
  status: z.enum(['pending', 'in_review', 'resolved']).optional(),
});

export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

// Review resolution (Req 4.2, 4.3): outcome is bounded to the framing/evidence-only
// Resolution_Outcome vocabulary; an optional note records reviewer rationale.
export const reviewResolutionSchema = z.object({
  outcome: z.enum(RESOLUTION_OUTCOMES),
  note: z.string().max(2000).optional(),
});

export type ReviewResolutionInput = z.infer<typeof reviewResolutionSchema>;
