---
type: "query"
date: "2026-06-30T20:00:09.854064+00:00"
question: "Does graphify incremental 'update' prune edges removed from re-extracted files?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["InMemoryRepository", "withTestApp()", "makeTestApp()"]
---

# Q: Does graphify incremental 'update' prune edges removed from re-extracted files?

## Answer

NO - incremental 'graphify update' adds new nodes/edges for changed files but does NOT prune edges that were REMOVED from those files. Evidence: migrated 8 route tests to drop their direct InMemoryRepository import (verified 0/8 reference it in source, full suite 358 pass). Across three successive 'graphify update .' runs the edge count ROSE (6329 -> 6335 -> 6341) instead of falling, and 'explain InMemoryRepository' still lists the migrated files (protectedRoutes, savedReports.routes, flag.persist, flag.unauth) as importers. So fan-in reductions, import removals, and deletions are invisible in the incrementally-updated graph until a FULL rebuild (/graphify) is run. Practical rule: trust incremental update for additions/new structure; run a full rebuild to confirm deletions or fan-in drops. Source files / test pass are the authoritative check for removals, not the incrementally-updated graph.

## Outcome

- Signal: useful

## Source Nodes

- InMemoryRepository
- withTestApp()
- makeTestApp()