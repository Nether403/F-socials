// Routes transcript acquisition by input type:
//   transcript -> passthrough (the user's pasted text)
//   youtube    -> YouTube provider
//   article    -> article provider (Firecrawl, later)
// The INPUT decides the fetcher — no global selector needed.

import type { RawInput } from '../types';
import type { Transcript, TranscriptProvider } from './types';
import { passthroughTranscript } from './mock';

export function makeTranscriptRouter(providers: {
  youtube?: TranscriptProvider;
  article?: TranscriptProvider;
}): TranscriptProvider {
  return {
    async fetch(input: RawInput): Promise<Transcript> {
      switch (input.sourceType) {
        case 'transcript':
          return passthroughTranscript.fetch(input);
        case 'youtube':
          if (!providers.youtube) throw new Error('YouTube ingestion is not configured.');
          return providers.youtube.fetch(input);
        case 'article':
          if (!providers.article) {
            throw new Error('Article ingestion is not wired yet — paste the article text as a transcript instead.');
          }
          return providers.article.fetch(input);
        default:
          return passthroughTranscript.fetch(input);
      }
    },
  };
}
