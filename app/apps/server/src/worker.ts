// Worker entrypoint: a long-running process, separate from the API_Server in the
// deployed configuration (Requirement 5.10). Shares the same composition root as
// index.ts (buildContext) so infra/provider wiring never drifts. No HTTP here.

import { config } from './config';
import { buildContext } from './compose';
import { makeWorker } from './pipeline/worker';

const { repo, cache, queue, providers, meta } = buildContext();

queue.process(
  makeWorker({
    repo,
    cache,
    providers,
    meta,
  }),
);

console.log(
  `f-Socials worker started | LLM_PROVIDER=${config.llmProvider} | queue=${config.queueDriver} | model=${meta.model}`,
);
