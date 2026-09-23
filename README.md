# RAG Test Case Intelligence — MongoDB Atlas Hybrid Search

**A full-stack RAG pipeline for healthcare QA: ingest Test Cases and User Stories from Excel, search them with vector, BM25, and hybrid search, rerank and summarize with an LLM, and generate new, context-grounded test cases, with impacted user stories flagged by regression risk.**

React UI → Express API → MongoDB Atlas (Vector Search + Atlas Search) · Mistral embeddings · Groq LLMs · Langfuse tracing.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&labelColor=20232a)
![MUI](https://img.shields.io/badge/MUI-7-007FFF?logo=mui&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![MongoDB Atlas](https://img.shields.io/badge/MongoDB-Atlas%20Vector%20Search-47A248?logo=mongodb&logoColor=white)
![Mistral](https://img.shields.io/badge/Embeddings-mistral--embed-FA520F)
![Groq](https://img.shields.io/badge/LLM-Groq-F55036)
![Langfuse](https://img.shields.io/badge/Tracing-Langfuse-0A0A0A)

---

## Table of Contents

1. [🎯 What is this?](#-what-is-this)
2. [✨ Key Features](#-key-features)
3. [🏗️ Architecture](#️-architecture)
4. [🔄 How it works](#-how-it-works)
5. [🤖 Where GenAI is used](#-where-genai-is-used)
6. [🧪 Test Case Generation](#-test-case-generation)
7. [📊 Example](#-example)
8. [📤 Export Options](#-export-options)
9. [🛠️ Tech Stack](#️-tech-stack)
10. [🚀 Getting Started](#-getting-started)
11. [📁 Project Structure](#-project-structure)
12. [🔐 Security / LLM Safety](#-security--llm-safety)
13. [🔮 Future Enhancements](#-future-enhancements)

---

## 🎯 What is this?

QA teams accumulate thousands of test cases and user stories, and finding the relevant ones for a new feature or release is slow. Keyword search misses paraphrases, and pure semantic search misses exact IDs and module names. This project is a self-hosted RAG pipeline over a healthcare QA corpus that lets a team:

- **Ingest** Test Case and User Story spreadsheets into MongoDB Atlas with 1024-dim Mistral embeddings.
- **Retrieve** with four search strategies side by side (vector, BM25, hybrid, and LLM reranking) so they can compare how each technique ranks the same query.
- **Augment** results by deduplicating near-identical test cases and asking an LLM for a concise or detailed coverage summary.
- **Generate** new test cases with Groq, grounded in the most relevant existing test cases and the user stories they would affect.

The whole pipeline runs in one app with a sidebar per stage: **Ingestion → Retrieval → Augmentation → Generation**.

## ✨ Key Features

| Module | What it does |
|---|---|
| 📄 **Convert to JSON** | Upload a Test Case or User Story `.xlsx`; columns are mapped to a JSON schema and written to `src/data/`. |
| 🧬 **Embeddings & Store** | Pick JSON files and run a background batch job that embeds each record with Mistral (`mistral-embed`, 1024-dim) and bulk-inserts into MongoDB. Progress is polled live. |
| 🔤 **Query Preprocessing** | Preview how a query is normalized (`tc-027` → `TC_027`), how healthcare abbreviations expand (`UHID`, `OP`, …), and which synonym variations it produces. |
| 🧭 **Vector Search** | Semantic search via Atlas `$vectorSearch` (cosine) with module/priority/risk/automation filters. |
| 🔎 **BM25 Search** | Keyword search via Atlas Search `$search` with fuzzy matching (`maxEdits: 1`) for typo tolerance. |
| 🔀 **Hybrid Search** | Runs BM25 and vector search in parallel, min-max normalizes both, and fuses them with UI-adjustable weights (default 50/50). Each hit is tagged `bm25`, `vector`, or `both`. |
| 🏆 **Reranking** | Pulls 50 candidates each from BM25 and vector search, merges them, and has a Groq LLM score each one 0–100 against the query. |
| 🧹 **Summarize & Dedup** | Removes near-duplicate test cases (Jaccard similarity on titles, default threshold 0.85), then produces a concise or 8-point detailed LLM summary. |
| 🧩 **Prompt & Schema** | Author a JSON schema and prompt template, then generate new test cases in **LLM-only** or **LLM + RAG** mode. Output is schema-validated and exportable as CSV. |
| 📈 **User Story Impact Analysis** | Hybrid search over `user_stories` that tags each related story with a regression-risk tier (High / Medium / Low) and an impact reason. |
| 🔭 **Langfuse Tracing** | Search, BM25, hybrid, dedup, summarize, and prompt-test requests each emit a Langfuse trace with nested spans for embedding, Mongo, and LLM calls. |

## 🏗️ Architecture

```
┌──────────────────────┐      ┌──────────────────────────┐      ┌────────────────────────────────┐
│  Frontend             │      │  Backend                  │      │  MongoDB Atlas                  │
│  React 19 + MUI 7     │ ───► │  Express (Node, ESM)       │ ───► │  test_cases  · user_stories     │
│  (CRA dev server)     │      │  :3001 (PORT)              │      │  Vector index + BM25 index each │
└──────────────────────┘      └─────────────┬────────────┘      └────────────────────────────────┘
                                             │
                     ┌───────────────────────┼────────────────────────┐
                     ▼                       ▼                        ▼
            ┌────────────────┐      ┌────────────────┐       ┌────────────────┐
            │  Mistral AI     │      │  Groq           │       │  Langfuse       │
            │  mistral-embed  │      │  rerank /       │       │  traces & spans │
            │  (1024-dim)     │      │  summarize /    │       │                 │
            └────────────────┘      │  generate       │       └────────────────┘
                                     └────────────────┘
```

- **Frontend**: a sidebar SPA with nine pipeline views plus Settings. Each component calls the Express API directly.
- **Backend**: a single Express app ([server/index.js](server/index.js)) that owns every route. Long-running embedding jobs run as spawned child processes, with job state tracked in memory.
- **Utilities**: [mistralEmbedding.js](src/scripts/utilities/mistralEmbedding.js) is the only module that calls Mistral. [groqClient.js](src/scripts/utilities/groqClient.js) holds the reranking and summarization calls. The `/api/test-prompt` route calls Groq directly with the user-authored prompt.
- **Data**: two collections (`test_cases`, `user_stories`), each with an Atlas Vector Search index and an Atlas Search (BM25) index defined in [src/config/](src/config/).

## 🔄 How it works

**Ingestion**

1. The user uploads an Excel file in **Convert to JSON**. `POST /api/upload-excel` maps the columns to the test case or user story schema and writes JSON to `src/data/`.
2. In **Embeddings & Store**, the user selects JSON files. `POST /api/create-embeddings-batch` spawns the matching batch script ([test cases](src/scripts/embeddings/create-embeddings-batch-mistral.js) or [user stories](src/scripts/embeddings/create-userstories-embeddings-batch-mistral.js)).
3. The script builds one embedding input string per record and embeds records in batches of 50, with at most 3 concurrent Mistral calls (`p-limit`). It then bulk-inserts them 100 at a time. Each document stores `embedding: number[1024]` and `embeddingMetadata` (model, tokens, cost).
4. The UI polls `GET /api/jobs/:jobId` every 2 seconds for progress.

**Retrieval**

1. *(Optional)* The query is preprocessed: normalization, abbreviation expansion, and synonym expansion ([src/scripts/query-preprocessing/](src/scripts/query-preprocessing/)).
2. Depending on the view, the query goes to:
   - **Vector**: embedded with Mistral, then `$vectorSearch` with `numCandidates = max(100, limit × 10)` so post-search filters don't starve the result set.
   - **BM25**: `$search` `text` operator across `id`, `title`, `description`, `steps`, `expectedResults`, and `module`.
   - **Hybrid**: both of the above in parallel, then min-max normalization and `hybridScore = bm25Norm × bm25Weight + vectorNorm × vectorWeight`.
   - **Rerank**: 50 BM25 and 50 vector candidates, merged and scored by Groq.

**Augmentation**

1. `POST /api/search/deduplicate` drops results whose titles are too similar to an earlier hit, based on word-set Jaccard similarity. No LLM is involved.
2. `POST /api/search/summarize` formats the remaining results (ID, module, priority, steps, expected results) and asks Groq for a concise or detailed summary.

## 🤖 Where GenAI is used

The project uses two model providers in four distinct roles:

| Role | Model | Where | What the model does |
|---|---|---|---|
| **Embedding** | Mistral `mistral-embed` (1024-dim) | [mistralEmbedding.js](src/scripts/utilities/mistralEmbedding.js) | Converts each test case, user story, and query into a vector for `$vectorSearch`. Retries with exponential backoff (3 attempts). |
| **LLM reranker** | Groq `GROQ_RERANK_MODEL` (default `llama-3.2-3b-preview`) | `rerankDocuments()` in [groqClient.js](src/scripts/utilities/groqClient.js) | Scores every candidate 0–100 for relevance at temperature 0, returning JSON only (`{"rankings":[{"index":0,"score":95}, …]}`). |
| **Summarizer** | Groq `GROQ_SUMMARIZATION_MODEL` (default `llama-3.3-70b-versatile`) | `summarizeResults()` in [groqClient.js](src/scripts/utilities/groqClient.js) | Writes a concise (2–3 sentence) or detailed summary covering functional coverage, priority and risk, edge cases, automation readiness, gaps, compliance, and integration points. |
| **Test case generator** | Groq `GROQ_RERANK_MODEL` | `POST /api/test-prompt` | Runs the user-authored prompt and returns new test cases matching the user-defined JSON schema. |

Guardrails around the LLM calls:

- **JSON-constrained prompts**: the reranker and generator prompts demand JSON only, and responses are parsed defensively (markdown fences stripped, `{…}` extracted by regex).
- **Graceful fallback**: if reranking fails or its JSON can't be parsed, results fall back to the original retrieval order instead of erroring.
- **Schema validation**: generated test cases are checked on the client against the expected `newTestCases` structure before display, and validation errors are surfaced in the UI.

`groqClient.js` also exports `generateAnswer()`, a classic context-grounded RAG QA helper with `[n]` citation extraction. It is **not wired to any route yet**.

## 🧪 Test Case Generation

The **Prompt & Schema** module turns the retrieval pipeline into a test-authoring tool. It has four tabs: JSON Schema, Prompt Template, Test & Preview, and Metrics Evaluation. Generation runs in two modes side by side, so their output can be compared:

**1. LLM only**: the prompt template and schema go straight to Groq via `POST /api/test-prompt`.

**2. LLM + RAG context**: the requirement is first run through the full pipeline:

1. `POST /api/search/preprocess`: normalize the query and expand abbreviations and synonyms.
2. `POST /api/search/hybrid`: find similar existing test cases.
3. `POST /api/search/user-stories`: find similar or impacted user stories, each tagged with a regression risk (High ≥ 0.80, Medium ≥ 0.60, otherwise Low) and an impact reason based on shared components, labels, epic, and dependencies. This step is non-critical and is skipped on failure.
4. `POST /api/search/rerank`: reorder the candidates with the LLM.
5. `POST /api/search/deduplicate`: collapse near-duplicates.
6. `POST /api/search/summarize`: condense the context.
7. `GET /api/testcases/latest-id`: continue ID numbering from the highest existing test case ID.
8. `POST /api/test-prompt`: generate new test cases grounded in that context.

Both modes return a `newTestCases` array that is validated, rendered, and exportable. The LLM + RAG mode also shows the reference test cases it used and the affected user stories.

## 📊 Example

Hybrid search via the API:

```bash
curl -X POST http://localhost:3001/api/search/hybrid \
  -H "Content-Type: application/json" \
  -d '{
    "query": "patient registration with UHID",
    "limit": 5,
    "bm25Weight": 0.5,
    "vectorWeight": 0.5,
    "filters": { "priority": "High" }
  }'
```

Response (abridged, values illustrative):

```json
{
  "success": true,
  "searchType": "hybrid",
  "query": "patient registration with UHID",
  "weights": { "bm25": 0.5, "vector": 0.5 },
  "results": [
    {
      "id": "TC_027",
      "title": "...",
      "bm25ScoreNormalized": 0.91,
      "vectorScoreNormalized": 0.88,
      "hybridScore": 0.895,
      "foundIn": "both"
    }
  ],
  "count": 5,
  "stats": { "foundInBoth": 3, "foundInBm25Only": 1, "foundInVectorOnly": 1 },
  "timing": { "bm25Time": 120, "vectorTime": 340, "totalTime": 480 },
  "model": "mistral-embed"
}
```

Sample release inputs (user story text files and a test case JSON) are in [releases/1.21.2/](releases/1.21.2/). Source spreadsheets are in [src/data/](src/data/).

## 📤 Export Options

| Output | From | Format |
|---|---|---|
| Converted dataset | Convert to JSON | **JSON** file in `src/data/`, ready for embedding |
| Generated test cases | Prompt & Schema → LLM only / LLM + RAG | **CSV** (`generated_test_cases_<date>.csv`) |
| Reference test cases used as RAG context | Prompt & Schema → LLM + RAG | **CSV** (`reference_test_cases_<date>.csv`) |
| Affected user stories with regression risk | Prompt & Schema → LLM + RAG | **CSV** (`affected_user_stories_<date>.csv`) |
| Search results, summaries, dedup stats | Search and Summarize views | On-screen (MUI DataGrid) |

## 🛠️ Tech Stack

**Frontend**: React 19, MUI 7 (`@mui/material`, `@mui/x-data-grid`, `@mui/lab`), React Router 7, notistack, Axios / `fetch`, Create React App (`react-scripts`).

**Backend**: Node.js (ESM), Express 4, Multer (file upload), `child_process.spawn` (background embedding jobs), `xlsx` (Excel → JSON), `p-limit` (embedding concurrency).

**Data**: MongoDB Atlas with Vector Search (`$vectorSearch`, cosine, 1024 dims) and Atlas Search / BM25 (`$search`, `lucene.standard` and `lucene.keyword` analyzers).

**GenAI**: Mistral AI `mistral-embed` for embeddings. Groq (`groq-sdk`) for reranking, summarization, and test case generation.

**Observability**: Langfuse (`langfuse` SDK). See [ReadmeLangfuse.md](ReadmeLangfuse.md) and [Architecture.md](Architecture.md).

## 🚀 Getting Started

Requires Node.js, a MongoDB Atlas cluster, and API keys for Mistral and Groq. Langfuse keys are optional.

```bash
# 1. Install server deps (the postinstall hook also installs client/ deps)
npm install

# 2. Create a .env at the repo root (see below)

# 3. Create the Atlas indexes on each collection using the JSON specs in src/config/
#    (vector + BM25 for test_cases, vector + BM25 for user_stories)

# 4. Run API (port 3001) and React dev server together
npm run dev
```

Other scripts: `npm run server` (API only), `npm run client` (UI only), `npm run build` (production client build).

<details>
<summary><strong>Environment variables</strong></summary>

All variables go in `.env` at the repo root. They can also be viewed and edited from the **Settings** view.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Express API port |
| `MONGODB_URI` / `DB_NAME` | — | Atlas connection and database |
| `COLLECTION_NAME` / `VECTOR_INDEX_NAME` / `BM25_INDEX_NAME` | — | Test Cases collection and its indexes |
| `USER_STORIES_COLLECTION_NAME` / `USER_STORIES_VECTOR_INDEX_NAME` / `USER_STORIES_BM25_INDEX_NAME` | — | User Stories collection and its indexes |
| `MISTRAL_API_KEY` / `MISTRAL_EMBEDDING_MODEL` | model: `mistral-embed` | Embeddings |
| `GROQ_API_KEY` | — | Groq access |
| `GROQ_RERANK_MODEL` | `llama-3.2-3b-preview` | Reranking and `/api/test-prompt` |
| `GROQ_SUMMARIZATION_MODEL` | `llama-3.3-70b-versatile` | Summarization |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | — | Langfuse tracing |
| `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`) | `https://cloud.langfuse.com` | Langfuse endpoint |

The embedding vector length (1024) must match `numDimensions` in the vector index configs.

</details>

<details>
<summary><strong>API reference (summary)</strong></summary>

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/files` | List JSON files available for embedding |
| POST | `/api/upload-excel` | Excel → JSON conversion |
| POST | `/api/create-embeddings-batch` | Start a background embedding job |
| POST | `/api/create-embeddings` | Simpler single-file embedding path |
| GET | `/api/jobs/:jobId`, `/api/jobs/active` | Embedding job progress |
| GET | `/api/metadata/distinct` | Distinct values for filter dropdowns |
| POST | `/api/search/preprocess`, `/api/search/analyze` | Query preprocessing (apply / dry-run) |
| POST | `/api/search` | Vector search |
| POST | `/api/search/bm25` | BM25 keyword search |
| POST | `/api/search/hybrid` | Hybrid BM25 + vector search (test cases) |
| POST | `/api/search/user-stories` | Hybrid search + regression-risk scoring (user stories) |
| POST | `/api/search/rerank` | Candidate retrieval + Groq reranking |
| POST | `/api/search/deduplicate` | Jaccard-based deduplication |
| POST | `/api/search/summarize` | Groq summarization |
| GET | `/api/testcases/latest-id` | Highest existing test case ID |
| POST | `/api/test-prompt` | Run a custom prompt against Groq |
| GET / POST | `/api/env` | Read / overwrite `.env` |

</details>

## 📁 Project Structure

```
.
├── package.json                  # Root scripts (dev, server, client, build)
├── .env                          # All configuration (not committed)
├── Architecture.md               # Langfuse tracing design
├── ReadmeLangfuse.md             # Langfuse integration guide
├── releases/1.21.2/              # Sample release inputs (user stories, test cases)
├── uploads/                      # Temp storage for uploaded Excel files
│
├── client/                       # React 19 + MUI 7 SPA
│   └── src/
│       ├── App.js                # Sidebar navigation → one component per view
│       └── components/
│           ├── data/             # ConvertToJson, EmbeddingsStore
│           ├── search/           # QuerySearch, BM25Search, HybridSearch, RerankingSearch
│           ├── processing/       # QueryPreprocessing, SummarizationDedup, PromptSchemaManager
│           └── settings/         # Settings (.env editor)
│
├── server/
│   └── index.js                  # Express app: every route, job tracking, Langfuse traces
│
└── src/
    ├── config/                   # Atlas vector + BM25 index definitions (JSON)
    ├── data/                     # Source spreadsheets and converted JSON
    └── scripts/
        ├── data-conversion/      # excel-to-json, excel-to-userstories, fetch-jira-stories
        ├── embeddings/           # Batch embedding jobs (test cases, user stories)
        ├── query-preprocessing/  # normalizer, abbreviationMapper, synonymExpander, dictionaries
        └── utilities/            # mistralEmbedding, groqClient, delete-all-documents
```

## 🔐 Security / LLM Safety

This is a local demo tool, and its security posture reflects that. Anyone extending it should know:

- **API keys stay server-side for LLM calls.** The browser never calls Mistral or Groq directly; all model traffic goes through Express.
- **But `/api/env` exposes and overwrites `.env`.** `GET /api/env` returns every variable, **including API keys and the MongoDB URI**, and `POST /api/env` rewrites the whole file. Combined with no authentication, this is the biggest risk if the server is reachable beyond localhost.
- **LLM output is not trusted blindly.** Rerank responses are parsed defensively and fall back to retrieval order on failure. Generated test cases are validated against the expected structure before display.
- **Prompt pass-through.** `/api/test-prompt` sends the user-authored prompt to Groq verbatim. That is intended for a prompt-engineering tool, but it means there is no prompt-injection filtering.
- **Observability.** Langfuse traces record inputs and outputs (queries, prompts, results), so treat the Langfuse project as containing the same data as the database.
- **What's missing today**: no authentication or rate limiting, open CORS (`cors()` with no allowlist), no file-type or size limit on Excel uploads, and uploaded files are served statically from `/uploads`.

## 🔮 Future Enhancements

- Remove or protect `/api/env`: at minimum, mask secrets on read and require authentication on write.
- API authentication, rate limiting, and a CORS origin allowlist.
- Multer file-type (`.xlsx`/`.xls`) and size limits, and temp-file cleanup after conversion.
- Wire `generateAnswer()` to an "Ask a question" endpoint for citation-backed QA over the corpus.
- Per-field BM25 boosting and Reciprocal Rank Fusion (RRF) as selectable fusion strategies in Hybrid Search.
- Server-side schema validation of generated test cases, and optional write-back of approved cases into `test_cases`.
- Extend Langfuse tracing to `/api/search/rerank` and `/api/search/user-stories`.
- Move in-memory job tracking to Redis, and add an automated test suite and CI.
