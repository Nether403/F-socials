---
type: "query"
date: "2026-06-30T16:24:11.622204+00:00"
question: "What connects name/private/version to the rest of the system? (1001 weakly-connected nodes)"
contributor: "graphify"
outcome: "useful"
source_nodes: ["name"]
---

# Q: What connects name/private/version to the rest of the system? (1001 weakly-connected nodes)

## Answer

Mostly nothing - and that is expected, not a documentation gap. Of ~1338 nodes with degree<=1: ~187 are config-file keys (package.json fields like name/private/version, tsconfig compilerOptions) that the AST lifted into 'contains' leaf nodes; the larger ~1117 are fine-grained ts/tsx symbols that are overwhelmingly PER-FILE TEST HELPERS and fixtures - fast-check arbitraries (scenarioArb, rateArb), mock factories (mockLlm, seedRepo, mockResolve), local consts (WORDS, NEWER, HERE), and a few single-use UI helpers (cn, NavItem, mobileNavItems). They are file-local leaves with only a 'contained-in' edge, so low connectivity is correct. This reflects the repo's heavy property-based-testing culture (357 code files, a large fraction *.test.ts) and inflates node count / depresses avg connectivity, but is a positive code-quality signal, not a missing-edge problem.

## Outcome

- Signal: useful

## Source Nodes

- name