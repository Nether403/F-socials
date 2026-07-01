---
type: "explain"
date: "2026-06-30T16:22:11.357581+00:00"
question: "Why does InMemoryRepository connect 29 communities (god node, degree 131)?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["InMemoryRepository", "Repository"]
---

# Q: Why does InMemoryRepository connect 29 communities (god node, degree 131)?

## Answer

REAL hub, not an artifact - every connection is an EXTRACTED import. InMemoryRepository (infra/memory.ts L61) is the offline-first in-memory persistence implementation. Via the DI pattern (infra/ports.ts Repository interface, wired in compose.ts), nearly every server test imports it to build a repo instance. That is the structural fingerprint of the steering rule 'with zero API keys, fall back to in-memory infra'. The 29-community span is TEST-FIXTURE coupling (every test needs a repo), not runtime coupling between subsystems. A shared test-harness helper could cut the fan-in but the centrality is legitimate.

## Outcome

- Signal: useful

## Source Nodes

- InMemoryRepository
- Repository