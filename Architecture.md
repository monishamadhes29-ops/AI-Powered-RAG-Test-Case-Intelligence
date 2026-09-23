# Langfuse Tracing Architecture — `/api/search`

## Purpose

This document describes the design for adding [Langfuse](https://langfuse.com) observability to the RAG search API. The goal is visibility into two things that are currently opaque in logs only: the cost/latency of the Mistral embedding call, and the behavior (inputs, filters, result scores) of the MongoDB Atlas `$vectorSearch` call.

**Scope:** only `POST /api/search` is instrumented. `POST /api/search/hybrid` and all other routes are explicitly out of scope for this pass (see "Out of scope" below).

## Components touched

| Component | Role |
|---|---|
| [server/index.js](server/index.js) | Singleton Langfuse client is created once at module load, near the existing `dotenv.config()` call ([server/index.js:19](server/index.js#L19)). |
| [server/index.js:1781-1919](server/index.js#L1781-L1919) — `POST /api/search` handler | Where the trace and its two child spans are created. |
| [src/scripts/utilities/mistralEmbedding.js](src/scripts/utilities/mistralEmbedding.js) — `generateEmbedding` | The call wrapped as a generation span (no changes needed inside this file — it's wrapped from the call site). |

## Trace structure

One trace per request to `/api/search`:

```
trace: "search"
  input: { query, filters }
  │
  ├── generation: "generate-embedding"
  │     model: "mistral-embed"
  │     input: query
  │     output: { tokens, cost }
  │     (wraps generateEmbedding(query) at server/index.js:1811)
  │
  └── span: "vector-search"
        input: aggregation pipeline (vector stage + filters + limit)
        output: results + scores
        (wraps collection.aggregate(pipeline).toArray() at server/index.js:1896)
  │
  output: final `results` array (same shape returned to the client)
```

- The trace's `output` is set right before `res.json(responseData)`, using the same `results` payload sent to the client — no separate serialization.
- The generation span records the token usage and cost that the handler already computes (`embeddingResult.usage`, `cost`) — no new cost-calculation logic is introduced.
- The vector-search span's `input` is the pipeline array already built in the handler ([server/index.js:1840](server/index.js#L1840)) — logged as-is, not reshaped.

## Client setup

- Add dependency: `npm install langfuse`
- New environment variables (added to `.env`, no real values committed):
  - `LANGFUSE_PUBLIC_KEY`
  - `LANGFUSE_SECRET_KEY`
  - `LANGFUSE_HOST`
- Client is a **singleton**: instantiated once at module load in `server/index.js`, imported/reused by the request handler — not re-created per request.

## Flush strategy

Langfuse batches events internally, so each handler explicitly calls:

```js
await langfuse.flushAsync();
```

- Once on the success path, right before `res.json(responseData)`.
- Once in the `catch` block, so failed requests still show up in the dashboard.

This is deliberate — the implementation does **not** rely on process-shutdown flush, since a single long-running Express process shouldn't be the only thing guaranteeing traces are sent, and future serverless/short-lived deployments would silently drop unflushed events.

## Out of scope (deliberate YAGNI cuts)

- **`/api/search/hybrid`** — not instrumented in this pass.
- **No generic tracing wrapper/helper** — `langfuse.trace()/span()/generation()` are called inline in the handler, not through an abstraction layer.
- **No config flag to toggle tracing on/off** — tracing is always on when the route is hit.
- **No batching or sampling logic** — every request is traced.

These may be revisited later if a second route needs the same instrumentation and duplication becomes a real problem — not before.

## Verification

Once implemented:
1. Start the server (`npm run server`).
2. Send a sample request: `POST /api/search` with `{ "query": "...", "limit": 5 }`.
3. Open the Langfuse dashboard and confirm:
   - One trace named `search` appears, with `input` = `{ query, filters }`.
   - It has two nested children: a `generate-embedding` generation (with model, tokens, cost) and a `vector-search` span (with pipeline input and results+scores output).
   - Trigger an error case (e.g. missing `query`) and confirm the trace still appears (via the `catch`-block flush).
