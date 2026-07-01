---
type: "query"
date: "2026-06-30T16:21:12.049439+00:00"
question: "Are the 32 INFERRED 'calls' edges involving t() correct?"
contributor: "graphify"
outcome: "corrected"
correction: "Component t(...) calls are the destructured return of useT(); they do not call the test-file local t in workspaceAuthedFetch.test.ts. The 32 INFERRED calls edges onto api_workspaceauthedfetch_test_t are false. useT() is the accurate i18n hub."
source_nodes: ["t()", "useT()"]
---

# Q: Are the 32 INFERRED 'calls' edges involving t() correct?

## Answer

NO - same node-collision class as resolve(). The canonical t() node is api_workspaceauthedfetch_test_t, a local 't' inside workspaceAuthedFetch.test.ts L77. The 32 INFERRED calls come from real React components (Report, SummaryLead, LanguageSelector, AuthPanel, HistoryView, etc.) that call the i18n translation function via 'const { t } = useT()' - a destructured closure returned by the useT() hook, NOT a top-level named symbol. The AST had no correct node to bind the t(...) calls to, so they collapsed onto a stray test-file local t. Conceptually right (components do call a translation function) but structurally wrong target. The REAL i18n consumption hub is useT() (community 7, defined in context.tsx, degree 45, all EXTRACTED) - that node is correct.

## Outcome

- Signal: corrected
- Correction: Component t(...) calls are the destructured return of useT(); they do not call the test-file local t in workspaceAuthedFetch.test.ts. The 32 INFERRED calls edges onto api_workspaceauthedfetch_test_t are false. useT() is the accurate i18n hub.

## Source Nodes

- t()
- useT()