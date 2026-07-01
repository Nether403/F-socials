---
type: "query"
date: "2026-06-30T16:18:30.519131+00:00"
question: "Why does resolve() bridge i18n Resolution to eleven persistence/review communities (betweenness 0.179)?"
contributor: "graphify"
outcome: "corrected"
correction: "resolve() in migration tests is node:path.resolve, not the i18n resolver; the 13 INFERRED calls edges onto i18n_resolve_resolve are false. i18n resolve() degree is really 3 (resolve.ts contains, translate calls, resolve.totality.test imports)."
source_nodes: ["resolve()", "translate()", "readMigration()", "applyMigrations()"]
---

# Q: Why does resolve() bridge i18n Resolution to eleven persistence/review communities (betweenness 0.179)?

## Answer

FALSE BRIDGE / name collision. The i18n resolve() node (app/apps/web/src/i18n/resolve.ts L8, community 46) has 16 edges but only 3 are real: imported by resolve.totality.test.ts, contained in resolve.ts, called by translate() - all legitimate i18n locale resolution. The other 13 INFERRED 'calls' edges come from migration/test helpers (readMigration, applyMigrations, readSrc) that import { resolve } from 'node:path' and call path.resolve() to locate db/migrations. The AST extractor collapsed all those node:path.resolve call-sites onto the only node labeled resolve() (the i18n one) because node:path is an unextracted external module. So the high betweenness is an extraction artifact, NOT real architecture. Real i18n resolution is cleanly isolated in community 46. Same class as the Step 4.5 health-check dangling/collapsed-edge warning; bare stdlib names (resolve/parse/get/query) are the collision culprits.

## Outcome

- Signal: corrected
- Correction: resolve() in migration tests is node:path.resolve, not the i18n resolver; the 13 INFERRED calls edges onto i18n_resolve_resolve are false. i18n resolve() degree is really 3 (resolve.ts contains, translate calls, resolve.totality.test imports).

## Source Nodes

- resolve()
- translate()
- readMigration()
- applyMigrations()