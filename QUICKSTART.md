# Quickstart

Follow these steps after cloning **`boardrule-rag`** to run the stack locally. Keep this file in sync when ports, scripts, or environment variables change.

## Prerequisites

- **Git**
- **Python 3.11+** (for `services/rule_engine`)
- **Node.js 20.19+** (required for `apps/web`: Prisma ORM 7; 22.x recommended upstream)
- **pnpm**, **npm**, or **yarn** (match whatever the `apps/web` package manager ends up using once `package.json` exists)

Recommended for the full stack:

- [**Supabase CLI**](https://supabase.com/docs/guides/cli) — local Postgres (**pgvector**), Storage (S3-compatible API), Studio (`supabase start`).
- **poppler** (for `pdf2image`; e.g. `brew install poppler` on macOS) on the machine running the rule engine.

## 1. Clone the repository

```bash
git clone <your-fork-or-upstream-url> boardrule-rag
cd boardrule-rag
```

## 2. Database & Storage (Supabase local)

From the repository root (requires [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase start
```

- **Postgres**: typically `postgresql://postgres:postgres@127.0.0.1:54322/postgres` — confirm with `supabase status`.
- **Studio**: `http://127.0.0.1:54323`
- **Storage (S3-compatible)**: e.g. `http://127.0.0.1:54321/storage/v1/s3` — buckets **`rulebook-raw`** and **`game-exports`** are created by `supabase/migrations/`.

**Migrations (two layers):**

1. **Supabase SQL** (`supabase/migrations/`) — applied when the local stack starts or on `supabase db reset`: enables **pgvector**, creates **`rulebook-raw`** and **`game-exports`** storage buckets.
2. **Prisma** (`apps/web/prisma/`) — application tables (`Game`, `Task`). Apply after the DB is up:

   ```bash
   cd apps/web
   cp .env.example .env   # set DATABASE_URL from `supabase status`
   npx prisma migrate deploy   # or: prisma migrate dev — when iterating on schema
   ```

Production: point `DATABASE_URL` at your hosted Supabase project’s connection string; run `prisma migrate deploy` in CI or release. Set **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** so **`apps/web`** uses **Supabase Storage** for uploads and exports (recommended). Without them, files fall back to `apps/web/storage/` on disk. The database stores **paths/keys only**, not file bodies.

Use the same `DATABASE_URL` for **`apps/web` (Prisma)** and **`services/rule_engine`** — the engine **requires** PostgreSQL for LangGraph checkpoints (there is no SQLite fallback). This also enables **pgvector** for indexing when configured (set `DATABASE_URL` / `PGVECTOR_DATABASE_URL` in the rule engine `.env`).

### Rulebook upload and the rule engine

When **`SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** are set, the web app uploads the PDF to Storage, then calls the rule engine **`POST /extract/pages`** with **`file_url`** (a short-lived signed HTTPS URL) instead of sending the file again in multipart form data. That shrinks the **Next.js → rule engine** request to a small form post. The engine already supports `file_url` (see `services/rule_engine/api/routers/extract.py`).

**Vercel / serverless note:** the browser still uploads the full file to your Next route first, which can hit **request body size limits** on serverless. A further step is **presigned upload**: the client obtains a **PUT** URL from an API route, uploads **directly to Supabase Storage**, then notifies the app with the object key so the server only calls `/extract/pages` with `file_url`. That avoids large bodies on Vercel entirely; not implemented yet, but Storage + signed URLs are the intended foundation.

## 3. Rule engine (`services/rule_engine`)

### 3.1 Create environment file

Copy the example env file:

```bash
cp services/rule_engine/.env.example services/rule_engine/.env
```

Edit `services/rule_engine/.env` and set at least the keys in the table below.

### 3.2 Environment variables (rule engine)

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google AI / Gemini API key (vision + text). |
| `DATABASE_URL` | Yes | `postgresql://` — LangGraph **PostgresSaver** (checkpoints) and `POST /build-index` vectors in **pgvector** when enabled. Use the same URL as **`apps/web`** (Supabase local or hosted). Optional override: `RULE_ENGINE_CHECKPOINT_URL` for checkpoints only. |
| `LANGCHAIN_TRACING_V2` | No | Set to `true` to enable LangSmith tracing. |
| `LANGCHAIN_API_KEY` | If tracing | LangSmith API key. |
| `LANGCHAIN_PROJECT` | No | Defaults to `boardrule-rag` in docs; set to group runs in LangSmith. |
| `LANGCHAIN_ENDPOINT` | No | Override only if your LangSmith deployment requires it. |
| `INDEX_STORAGE_ROOT` | No | Per-game **BM25** + manifests (default `services/rule_engine/data/indexes/`). |
| `PAGE_RASTER_DPI` / `PAGE_RASTER_MAX_SIDE` | No | PDF page render quality for `/extract/pages`. |
| `GEMINI_EMBEDDING_MODEL` | No | Gemini embedding model id for `POST /build-index` (default `gemini-embedding-001`). |
| `EMBEDDING_DIM` | No | Must match the embedding model (default `3072` for `gemini-embedding-001`). |
| `RERANK_MODEL` | No | Cross-encoder name for reranking (default `cross-encoder/ms-marco-MiniLM-L-6-v2`; first run may download weights). |

See `services/rule_engine/.env.example` for the full list.

### 3.3 Install and run

After `pyproject.toml` is added to this service, from the repo root:

```bash
cd services/rule_engine
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"     # or: uv sync --extra dev — see services/rule_engine/README.md
```

Start the API (default dev port **8000**; exact module path follows the implemented package layout):

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

**Health check:**

```bash
curl -s http://127.0.0.1:8000/health
```

### 3.4 LangGraph Studio (optional)

To inspect the extraction **LangGraph** in **Studio** (graph view and debugging), install dev dependencies as above, then from `services/rule_engine`:

```bash
langgraph dev --config langgraph.json
```

This starts the LangGraph dev API (another port, often **2024**) and is separate from `uvicorn` on **8000**. Details: **[services/rule_engine/README.md](./services/rule_engine/README.md)** (section **LangGraph Studio**).

## 4. Web app (`apps/web`)

When `apps/web` is present:

### 4.1 Environment variables (web)

Copy `apps/web/.env.example` to `apps/web/.env` and adjust values.

| Variable | Required | Description |
|----------|----------|-------------|
| `RULE_ENGINE_URL` | Yes | Base URL of the rule engine, e.g. `http://localhost:8000`. The frontend must call **only** this backend (no Dify keys). |
| `DATABASE_URL` | Yes | Prisma connection string: Supabase local (`postgres` on **54322**) or hosted project URL from the dashboard. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Strongly recommended | Use **raw** + **exports** buckets (`SUPABASE_STORAGE_BUCKET_RAW` / `SUPABASE_STORAGE_BUCKET_EXPORTS`, see `apps/web/.env.example`). Raw uploads can be removed after extraction completes. **Presigned upload**: `POST /api/games/[gameId]/upload-sign` then JSON `POST .../upload` with `storageKey`. Without Supabase, files use `apps/web/storage/`. |
| Storage | No | Defaults to `apps/web/storage/` if Supabase env vars are unset. |

**Web rulebook UI:** game detail page supports **PDF**, **multiple images**, or **Gstone URL** (preview API), then **thumbnail click** for TOC/exclude before extract.

**Prisma ORM 7 notes:** The database URL is configured in `apps/web/prisma.config.ts` (with `dotenv` for CLI). The client is generated into `apps/web/generated/prisma/` (gitignored). `npm install` runs `prisma generate` via `postinstall`. At runtime, **`postgresql://`** URLs use `@prisma/adapter-pg` + `pg`; **`file:`** URLs use `@prisma/adapter-better-sqlite3` + `better-sqlite3`.

### 4.2 Install and run

```bash
cd apps/web
npm install          # or pnpm install / yarn
npx prisma migrate dev   # applies migrations (DATABASE_URL must be set, e.g. in .env)
npm run dev          # default Next.js port is usually 3000
```

Open `http://localhost:3000` (or the port shown in the terminal).

## 5. End-to-end smoke test

1. Rule engine responds on `GET /health`.
2. With `GOOGLE_API_KEY` set, call **`POST /extract/pages`** with `game_id` and either **`file`** (multipart) or **`file_url`** (form field) to rasterize a PDF, then **`POST /extract`** with `page_job_id`, `toc_page_indices`, `exclude_page_indices` (JSON arrays as strings). Poll **`GET /extract/{job_id}`** until `completed`. (The web UI uploads to Storage when configured, then uses **`file_url`** for rasterization.)
3. **验收辅助**：将合并后的 Markdown 存盘，运行 `python services/rule_engine/eval/check_extraction_output.py merged.md --min-words 3000 --min-page-markers 5` 检查字数与 `<!-- pages: -->` 锚点数量。
4. **LangSmith**：设置 `LANGCHAIN_TRACING_V2=true` 与 `LANGCHAIN_API_KEY`，在项目中查看与 `toc_analyzer` / `chapter_extract` 等节点对齐的 Run。
5. **索引（Phase 2）**：调用 `POST /build-index`（JSON：`game_id` 与 `merged_markdown` **或** `documents[]`）。若配置了 PostgreSQL + pgvector，向量写入 PG；BM25 仍落盘。再访问 `GET /index/{game_id}/manifest` 与 `GET /index/{game_id}/smoke-retrieve?q=…`。
6. **Web**：游戏详情页在提取完成后可预览 Markdown，并手动 **建立索引**；**Chat** 未建索引时返回 **409**。
7. **问答（Phase 3）**：在已为该 `game_id` 建索引的前提下，调用 `POST /chat` 或 Next.js `POST /api/chat`。

## 6. Common issues

| Symptom | What to check |
|--------|----------------|
| **Connection refused** to rule engine | Rule engine running; `RULE_ENGINE_URL` matches host/port (e.g. `http://127.0.0.1:8000`). |
| **CORS errors** | Rule engine should allow the web origin only; ensure FastAPI CORS includes your Next dev origin (e.g. `http://localhost:3000`). |
| **poppler / pdf2image errors** | Install poppler (`brew install poppler` on macOS); ensure `PAGE_RASTER_DPI` is reasonable. |
| **PostgreSQL / migrate** | `supabase start`; `DATABASE_URL` matches `supabase status` in **both** `apps/web/.env` and `services/rule_engine/.env`; run `npx prisma migrate deploy` (or `migrate dev`) in `apps/web`. |
| **Rule engine exits on startup** | Set `DATABASE_URL=postgresql://...` for the engine (see `services/rule_engine/.env.example`). SQLite checkpoints are not supported. |
| **Gemini / `GOOGLE_API_KEY` errors** | Billing and API enablement for the Generative Language API in Google Cloud. |
| **Port already in use** | Change `--port` for uvicorn or Next’s port via `-p` / `PORT`. |
| **Prisma / DB errors** | `DATABASE_URL` correct; run `prisma migrate dev` after schema changes. |

## 7. Further reading

- [services/rule_engine/README.md](./services/rule_engine/README.md) — Python tooling and running the engine in isolation.
