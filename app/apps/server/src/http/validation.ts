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
