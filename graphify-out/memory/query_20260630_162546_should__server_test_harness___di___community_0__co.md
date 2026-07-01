---
type: "explain"
date: "2026-06-30T16:25:46.293050+00:00"
question: "Should 'Server Test Harness & DI' (community 0, cohesion 0.04) be split into smaller modules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["makeRouter()", "requireAuth()", "InMemoryCache", "verifyJwt()"]
---

# Q: Should 'Server Test Harness & DI' (community 0, cohesion 0.04) be split into smaller modules?

## Answer

NO - the low cohesion is a test-fixture clustering artifact, not tangled production code. Community 0 has 104 members but only 16 are production code; 88 are test files. The 16 production symbols are already cleanly split across 5 files in two coherent themes: (1) auth/identity - auth.ts (requireAuth/optionalAuth/reviewerGuard/apiKeyAuth) + supabase.ts (verifyJwt/AuthUser), and (2) offline-first fallbacks - memory.ts (InMemoryCache/Queue/RateLimiter) + noop.ts (noopTelemetry), tied together by makeRouter() in routes.ts. Leiden lumped them because every route/auth test imports BOTH the auth middleware AND the in-memory/no-op fixtures to bootstrap an app (same test-fixture gravity well as InMemoryRepository). Actionable lever is NOT a code split (code is already well-separated) but a shared test bootstrap helper e.g. makeTestApp() to collapse redundant fixture imports, which would also let Leiden separate auth from infra into natural communities.

## Outcome

- Signal: useful

## Source Nodes

- makeRouter()
- requireAuth()
- InMemoryCache
- verifyJwt()