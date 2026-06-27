# f-Socials — code

A media-literacy lens, not a judge. This is the first slice: submit an input → cache check → queued job → worker runs the analysis pipeline (transcript → extract → evidence → perspectives → invariant gate) → stored report.

**It runs offline with zero API keys** using mock providers and in-memory infra. Swap each behind its interface for real services (see `../f-Socials-resources-shopping-list.md`).

## Run it

```bash
cd app
npm install
npm test         # the invariant gate check — must stay green
npm run typecheck
npm run dev       # starts the API on http://localhost:4000
```

## Try the flow (dev server running)

```bash
# submit a transcript (works with no API keys)
curl -X POST http://localhost:4000/api/v1/analyses ^
  -H "Content-Type: application/json" ^
  -d "{\"sourceType\":\"transcript\",\"transcript\":\"A study found that 80 percent of people agree. This is shocking and everyone should be outraged!\"}"

# -> { "reportId": "...", "status": "queued", "cached": false }

# fetch the report (processing is near-instant with mocks)
curl http://localhost:4000/api/v1/analyses/<reportId>
```

Submit the same input again and you'll get `"cached": true` — the URL-hash cache in action.

## Structure

```
app/
  apps/server/
    src/
      types.ts              domain types (mirror the SQL enums)
      config.ts
      core/
        hash.ts             normalize + sha256 cache key
        assemble.ts         THE invariant gate (lens-not-judge)
      pipeline/
        stages.ts           transcript -> extract -> evidence -> perspectives -> gate
        worker.ts           job consumer; persists + caches
      providers/
        types.ts            TranscriptProvider / LLMProvider / EvidenceProvider / PerspectiveProvider
        mock.ts             offline stand-ins (swap these)
      infra/
        ports.ts            Cache / Queue / Repository interfaces
        memory.ts           in-memory impls (swap for Redis + Postgres)
      http/
        validation.ts       zod input validation at the trust boundary
        routes.ts           POST /analyses, GET /analyses/:id, /status
      index.ts              composition root (wire + listen)
    test/
      invariant.test.ts     the one non-negotiable check
  db/migrations/001_init.sql  full Postgres schema for when you wire the DB
```

## Swap points (mock → real)

| Interface | Now | Later |
|---|---|---|
| `TranscriptProvider` | passthrough | router: paste ✓ · YouTube/Supadata ✓ · article/Firecrawl ✓ | by input type |
| `LLMProvider` | sentence splitter | OpenAI / Claude / Gemini |
| `EvidenceProvider` | mock citation | Google Fact Check API |
| `PerspectiveProvider` | mock links | GDELT / NewsAPI + vector match |
| `Cache` / `Queue` | in-memory (default) | **Upstash Redis** (ioredis + BullMQ) via `CACHE_DRIVER`/`QUEUE_DRIVER=upstash` ✓ |
| `Repository` | in-memory (default) | **Neon Postgres** (`pg`) via `REPO_DRIVER=postgres` ✓ — run `npm run migrate` first |

Each swap = implement one interface and change one line in `index.ts`. No core changes.

## Not built yet (next slices)

Auth, rate limiting (interface-ready), real providers, the React app, expert review queue, dispute flow, public share route. See `../f-Socials-v1-product-definition.md`.

> ⚠️ Before exposing this publicly: the analysis endpoint triggers paid LLM/transcription calls once real providers are wired. Add auth + rate limiting first (it's in the spec).
