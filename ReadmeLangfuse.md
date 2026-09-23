# Langfuse Tracing — README

Observability for `POST /api/search`, added via [Langfuse](https://langfuse.com). This document covers only the Langfuse integration — flow, functionality, every file it touches, and its `.env` configuration. For the design rationale (why this was scoped the way it was), see [Architecture.md](Architecture.md).

## Functionality

Every call to `POST /api/search` produces one Langfuse **trace** with two nested **observations**:

- A **generation** around the Mistral embedding call — records the model, the query text, and the resulting token count/cost.
- A **span** around the MongoDB `$vectorSearch` aggregation — records the pipeline sent to Mongo and the scored results it returned.

The trace also carries a `userId` — a per-browser anonymous ID — so requests can be correlated back to a browser session in the Langfuse dashboard, and the trace's top-level `input`/`output` mirror exactly what the client sent and received.

No other route (`/api/search/bm25`, `/api/search/hybrid`, etc.) is instrumented.

## Flow

```
Browser (QuerySearch.js)
  │  generates/reuses an anonymous userId (localStorage)
  │  POST /api/search  { query, limit, filters, userId }
  ▼
server/index.js — POST /api/search handler
  │
  ├─ langfuse.trace({ name: "search", userId, input: { query, filters } })
  │
  ├─ trace.generation({ name: "generate-embedding", model: "mistral-embed", input: query })
  │     await generateEmbedding(query)   // Mistral API call
  │     .end({ output: { tokens, cost }, usage: { totalTokens } })
  │
  ├─ trace.span({ name: "vector-search", input: pipeline })
  │     await collection.aggregate(pipeline).toArray()   // MongoDB $vectorSearch
  │     .end({ output: results })
  │
  ├─ trace.update({ output: results })
  ├─ res.json(responseData)                 // client gets its response immediately
  └─ await langfuse.flushAsync()             // then the trace is sent to Langfuse
        (also runs in the catch block, so failed requests are traced too)
```

Flushing is explicit and awaited on both the success and error paths — the SDK's internal batching is never left to flush itself on process shutdown.

## Impacted files

| File | What changed |
|---|---|
| [package.json](package.json#L23) | Added `"langfuse": "^3.38.20"` dependency. |
| [.env](.env#L21-L24) | Added `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`. |
| [server/index.js:15](server/index.js#L15) | `import { Langfuse } from 'langfuse'`. |
| [server/index.js:22-26](server/index.js#L22-L26) | Singleton `langfuse` client, constructed once at module load from the env vars above. |
| [server/index.js:1788-1953](server/index.js#L1788-L1953) | The `POST /api/search` handler — trace creation, the `generate-embedding` generation, the `vector-search` span, trace output, and the two `flushAsync()` calls. Relevant lines: trace creation ([1790-1796](server/index.js#L1790-L1796)), generation ([1818-1840](server/index.js#L1818-L1840)), span ([1915-1917](server/index.js#L1915-L1917)), flush ([1932-1952](server/index.js#L1932-L1952)). |
| [client/src/components/search/QuerySearch.js:37-47](client/src/components/search/QuerySearch.js#L37-L47) | `getAnonymousUserId()` — creates/reuses a `crypto.randomUUID()` stored in `localStorage`. |
| [client/src/components/search/QuerySearch.js:119-124](client/src/components/search/QuerySearch.js#L119-L124) | The `axios.post` call to `/api/search` now includes `userId: getAnonymousUserId()` in the request body. |

## `.env` configuration

Added to [.env](.env), directly below the existing Groq config block:

```
# Langfuse Configuration (for tracing /api/search)
LANGFUSE_PUBLIC_KEY=<your Langfuse project public key, starts with pk-lf-...>
LANGFUSE_SECRET_KEY=<your Langfuse project secret key, starts with sk-lf-...>
LANGFUSE_HOST=<your Langfuse instance URL, e.g. https://cloud.langfuse.com>
```

These three are read once at server startup ([server/index.js:22-26](server/index.js#L22-L26)) to construct the singleton client — changing them requires restarting the Node process (`node server/index.js` has no hot-reload).

## Verifying it's working

1. Start the server, make a search from the UI (or `curl -X POST http://localhost:3001/api/search -d '{"query":"...","limit":5}' -H "Content-Type: application/json"`).
2. Server logs should show `✅ Langfuse trace flushed: <trace-id>` right after `📤 Sending response with N results`.
3. In the Langfuse dashboard, open **Traces** (not **Observations**) and filter by name `search` — you should see one trace per request, with a `userId`, the query/filters as input, the matched results as output, and two nested observations (`generate-embedding`, `vector-search`).
