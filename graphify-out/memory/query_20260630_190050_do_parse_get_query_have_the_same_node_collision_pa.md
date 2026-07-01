---
type: "query"
date: "2026-06-30T19:00:50.107760+00:00"
question: "Do parse/get/query have the same node-collision pattern as resolve()/t()?"
contributor: "graphify"
outcome: "corrected"
correction: "parse/get/query are NOT collisions; only bare free-function names collide. .render() IS a third collision (RTL render calls collapsed onto App.tsx render). The 9 INFERRED calls edges onto App's .render() are false."
source_nodes: ["resolve()", ".render()", "makeRouter()"]
---

# Q: Do parse/get/query have the same node-collision pattern as resolve()/t()?

## Answer

NO for parse/get/query - YES for a newly found node .render(). Systematic scan (INFERRED inbound 'calls' >=3 spanning >=3 communities) found only 4 candidates: resolve() (known, path.resolve collision), .render() (NEW), makeRouter() (real factory, 6 EXTRACTED + real test fan-in, not a collision), useT() (29 EXTRACTED, real hub). parse() does not exist as a node. get/set/query/run exist ONLY as dot-qualified method nodes (.get() in memory.ts AND redis.ts, .query() x2 in reportGraph tests, .set(), .run()) kept as SEPARATE per-file nodes with no cross-community INFERRED inbound - they fragmented, not collided. RULE: bare unqualified free-function names (resolve, t, render) collapse onto one global node and collide; dot-qualified method calls (.get/.query) are scoped per-receiver and fragment instead. .render() is a confirmed collision: defined in App.tsx, 9 INFERRED inbound 0 EXTRACTED, all 9 callers are test render-wrappers (renderPanel/renderHistory/renderWithLang/renderDetail/renderList etc.) calling React Testing Library render(...), collapsed onto the app's own render.

## Outcome

- Signal: corrected
- Correction: parse/get/query are NOT collisions; only bare free-function names collide. .render() IS a third collision (RTL render calls collapsed onto App.tsx render). The 9 INFERRED calls edges onto App's .render() are false.

## Source Nodes

- resolve()
- .render()
- makeRouter()