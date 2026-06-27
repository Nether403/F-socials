// Input validation at the trust boundary. zod rejects malformed/oversized input
// before it ever reaches the pipeline or any paid provider.

import { z } from 'zod';

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
