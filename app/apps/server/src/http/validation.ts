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

// Save/remove path parameter (Req 10.4): the report :id must be a UUID. Malformed
// ids are rejected with 400 before any persistence side effect. History takes no input.
// Reused for the institutional-workspace :cid/:aid/:reportId UUID path params.
export const reportIdParam = z.string().uuid();

// Institutional workspace bodies (Req 8.4, 1.4, 5.4, 7.6). Names are trimmed and
// bounded so empty/whitespace-only or oversized labels are rejected at the boundary.
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(100) });

export type WorkspaceNameInput = z.infer<typeof workspaceNameSchema>;

export const collectionNameSchema = z.object({ name: z.string().trim().min(1).max(100) });

export type CollectionNameInput = z.infer<typeof collectionNameSchema>;

// A collection item references a report by UUID (Req 5.4).
export const collectionItemSchema = z.object({ reportId: z.string().uuid() });

export type CollectionItemInput = z.infer<typeof collectionItemSchema>;

// Annotation text is bounded to a non-empty, reasonably sized note (Req 7.6).
export const annotationTextSchema = z.object({ text: z.string().min(1).max(4000) });

export type AnnotationTextInput = z.infer<typeof annotationTextSchema>;

// Invite code path/body parameter (Req 1.4): non-empty, bounded opaque token.
export const inviteCodeParam = z.string().min(1).max(200);
