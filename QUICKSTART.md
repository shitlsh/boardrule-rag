# Quickstart

Follow these steps after cloning **`boardrule-rag`** to run the stack locally. Keep this file in sync when ports, scripts, or environment variables change.

## Prerequisites

- **Git**
- **Python 3.11+** (for `services/rule_engine`)
- **Node.js 20.19+** (required for `apps/web`: Prisma ORM 7; 22.x recommended upstream)
- **npm** (the repo ships `apps/web/package-lock.json`; **pnpm** / **yarn** work if you prefer, but keep one lockfile strategy)

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
2. **Prisma** (`apps/web/prisma/`) — application tables (`Game`, `Task`, `AppSettings`, `RateLimit`). Apply after the DB is up:

   ```bash
   cd apps/web
   cp .env.example .env   # set DATABASE_URL from `supabase status`
   npx prisma migrate deploy   # or: prisma migrate dev — when iterating on schema
   ```

   The migration `20260408000000_add_wechat_and_rate_limit` adds:
   - `AppSettings.wechatConfigJson` — AES-256-GCM encrypted WeChat AppID/AppSecret blob
   - `AppSettings.dailyChatLimit` — per-user daily chat quota (default `20`; `0` = unlimited)
   - `RateLimit` table — per-user daily counter keyed `wx:{openid}:{YYYY-MM-DD}`

Production: point `DATABASE_URL` at your hosted Supabase project’s connection string; run `prisma migrate deploy` in CI or release. Set **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** so **`apps/web`** uses **Supabase Storage** for uploads and exports (recommended). Without them, files fall back to `apps/web/storage/` on disk. The database stores **paths/keys only**, not file bodies.

Use the same `DATABASE_URL` for **`apps/web` (Prisma)** and **`services/rule_engine`** — the engine **requires** PostgreSQL for LangGraph checkpoints (there is no SQLite fallback). With a normal `postgresql://` URL, **new** LlamaIndex vectors are stored in **pgvector** in that database; BM25 + manifest stay on disk or in Storage when configured.

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
| `DATABASE_URL` | Yes | `postgresql://` — LangGraph **PostgresSaver** (checkpoints) and **pgvector** for new indexes. Use the same URL as **`apps/web`** (Supabase local or hosted). |
| `CORS_ORIGINS` | Recommended | Comma-separated browser origins for FastAPI CORS (default in `.env.example`: `http://localhost:3000`). Must include your **`apps/web`** origin. |
| *(Gemini keys / models)* | — | **Not set in the rule engine `.env`.** The **`apps/web`** BFF sends header **`X-Boardrule-Ai-Config`** on `POST /extract`, `POST /build-index/start`, `POST /chat`, etc. Configure Gemini API keys and per-slot models in the web app (**`/models`**). See §4.1. |
| `LANGCHAIN_TRACING_V2` | No | Set to `true` to enable LangSmith tracing. |
| `LANGCHAIN_API_KEY` | If tracing | LangSmith API key. |
| `LANGCHAIN_PROJECT` | No | Defaults to `boardrule-rag` in docs; set to group runs in LangSmith. |
| `LANGCHAIN_ENDPOINT` | No | Override only if your LangSmith deployment requires it. |
| `INDEX_STORAGE_ROOT` | No | Per-game **BM25** + manifests (default `services/rule_engine/data/indexes/`). |
| `INDEX_STORAGE_MODE` + `SUPABASE_*` | No | Set `INDEX_STORAGE_MODE=supabase` plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to zip/upload index bundles to the **`boardrule-indexes`** bucket (see **[DEPLOY.md](./DEPLOY.md)**). Local `supabase start` uses the same pattern as hosted. |
| `PAGE_RASTER_DPI` / `PAGE_RASTER_MAX_SIDE` | No | PDF page render quality for `/extract/pages`. |
| `EMBEDDING_DIM` | No | Vector width for pgvector / indexing (default `3072`). **Must match** the embedding model chosen in **AI Gateway** (Embed slot). |
| `RERANK_MODEL` | No | Cross-encoder name for reranking (default `BAAI/bge-reranker-base`; first run may download weights). |

See `services/rule_engine/.env.example` for the full list (commented blocks for index, vision graph, etc.).

### 3.2.5 Python: use one virtual environment

A **virtual environment** (`.venv`) is just a folder with its own Python and `pip` installs. If you create **both** `<repo>/.venv` (at the monorepo root) and **`services/rule_engine/.venv`**, they are **two separate worlds** — installing packages in one does not affect the other. That is why commands like `langgraph` or `uvicorn` could fail with “module not found”: the shell was using a different `python` than you thought.

**Recommendation for rule engine work:** use **only** `services/rule_engine/.venv`. Always:

1. `cd services/rule_engine`
2. `source .venv/bin/activate` (Windows: `.venv\Scripts\activate`)
3. Run `uvicorn`, `langgraph`, `pytest`, etc.

If you no longer need a stray **root** `.venv`, close any terminal using it and delete the `<repo>/.venv` folder to avoid confusion (you can always recreate it).

**Optional:** one shared venv at the **repo root** is fine *instead* — create it at the root and run `pip install -e "services/rule_engine/[dev]"` once. Then every Python tool should use that same activated venv. Do not rely on two different `.venv` folders unless you know which terminal uses which.

### 3.3 Install and run

From the repo root:

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

To inspect the extraction **LangGraph** in **Studio** (graph view and debugging), use the **same** venv as in §3.2.5 / §3.3 (`pip install -e ".[dev]"` must have succeeded in that environment). Then from `services/rule_engine`:

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
| `RULE_ENGINE_URL` | Yes | Base URL of the rule engine, e.g. `http://127.0.0.1:8000` (no trailing slash). Server routes proxy to the engine; there is no separate “AI backend” besides this + AI Gateway settings. |
| `DATABASE_URL` | Yes | Prisma connection string: Supabase local (`postgres` on **54322**) or hosted project URL from the dashboard. |
| `AI_CONFIG_SECRET` | Yes | Long random string used to **AES-256-GCM** encrypt Gemini API keys stored in app settings. Required before saving credentials on **`/models`**. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Strongly recommended | Use **raw** + **exports** buckets (`SUPABASE_STORAGE_BUCKET_RAW` / `SUPABASE_STORAGE_BUCKET_EXPORTS`, see `apps/web/.env.example`). Raw uploads can be removed after extraction completes. **Presigned upload**: `POST /api/games/[gameId]/upload-sign` then JSON `POST .../upload` with `storageKey`. Without Supabase, files use `apps/web/storage/`. |
| Storage | No | Defaults to `apps/web/storage/` if Supabase env vars are unset. |
| `AI_CONFIG_SECRET` | Yes (for AI Gateway + WeChat config) | 32-byte hex string used for AES-256-GCM encryption of stored API keys and WeChat AppSecret. Generate with `openssl rand -hex 32`. |

### 4.1.1 AI Gateway (Gemini credentials & models)

1. Start **`apps/web`** with `AI_CONFIG_SECRET` set.
2. Open **`/models`** (模型与凭证): add at least one Gemini credential (API key), then assign **Flash / Pro / Embed / Chat** slots to a credential and pick a model from the filtered list for each slot. Save per slot when prompted.
3. The web app persists this in **`AppSettings.aiGatewayJson`** and, when calling the rule engine, attaches header **`X-Boardrule-Ai-Config`** with the resolved keys and model IDs. The rule engine does **not** read `GOOGLE_API_KEY` from its own `.env` for those calls.

Chat temperature / max tokens are configured on the models UI where applicable.

**Direct `curl` to the rule engine:** for `POST /extract`, `POST /build-index/start`, or `POST /chat`, you must supply the same JSON header the BFF would send (or run flows through the web so the header is added automatically).

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
2. Configure **AI Gateway** in **`apps/web`** (`/models`: credentials + all required slots). Then either use the **web UI** for extract, or call the engine with **`X-Boardrule-Ai-Config`** as the web would. **`POST /extract/pages`** only rasterizes pages (no Gemini); **`POST /extract`** needs the header for vision/text. Flow: **`POST /extract/pages`** with `game_id` and **`file`** (multipart) or **`file_url`** (form field), then **`POST /extract`** with `page_job_id`, `toc_page_indices`, `exclude_page_indices` (JSON arrays as strings). Poll **`GET /extract/{job_id}`** until `completed`. (The web UI uploads to Storage when configured, then uses **`file_url`** for rasterization.)
3. **验收辅助**：将合并后的 Markdown 存盘，运行 `python services/rule_engine/eval/check_extraction_output.py merged.md --min-words 3000 --min-page-markers 5` 检查字数与 `<!-- pages: -->` 锚点数量。
4. **LangSmith**：设置 `LANGCHAIN_TRACING_V2=true` 与 `LANGCHAIN_API_KEY`，在项目中查看与 `toc_analyzer` / `chapter_extract` 等节点对齐的 Run。
5. **索引（Phase 2）**：调用 **`POST /build-index/start`**（同上 JSON 体），携带 **`X-Boardrule-Ai-Config`**；用返回的 `job_id` 轮询 **`GET /build-index/jobs/{job_id}`** 至 `completed`。若配置了 PostgreSQL + pgvector，向量写入 PG；BM25 仍落盘。再访问 `GET /index/{game_id}/manifest` 与 `GET /index/{game_id}/smoke-retrieve?q=…`。
6. **Web**：游戏详情页在提取完成后可预览 Markdown，并 **建立索引**（BFF 异步提交引擎任务并轮询）；**Chat** 未建索引时返回 **409**。
7. **问答（Phase 3）**：在已为该 `game_id` 建索引的前提下，调用 `POST /chat` 或 Next.js `POST /api/chat`（同样需要 AI 配置头）。

## 6. WeChat miniapp rate limiting

`POST /api/chat` supports per-user daily quotas when requests come from the miniapp. The flow:

1. Miniapp calls `POST /api/wx-login` with a fresh `uni.login()` code → BFF exchanges it for a WeChat `openid` via `jscode2session` → miniapp caches the openid locally and sends it as `x-user-id` on every chat request.
2. BFF reads `x-user-id`, looks up `AppSettings.dailyChatLimit`, and increments a counter in the `RateLimit` table (`wx:{openid}:{YYYY-MM-DD}`). When the counter reaches the limit a **429** is returned with a user-friendly message.
3. If `x-user-id` is absent (e.g. direct API calls, browser dev tools) the check is **skipped entirely** — no impact on local development.
4. If the DB check throws (e.g. `RateLimit` table missing before migration) the route **fails open** and the chat request proceeds normally.

**Configuration** (in the web admin UI at `/settings`):

| Setting | Where stored | Default | Notes |
|---------|--------------|---------|-------|
| WeChat AppID | `AppSettings.wechatConfigJson` | — | Plain text inside the encrypted blob |
| WeChat AppSecret | `AppSettings.wechatConfigJson` | — | AES-256-GCM encrypted via `AI_CONFIG_SECRET` |
| Daily chat limit | `AppSettings.dailyChatLimit` | `20` | `0` = unlimited |

To enable for the first time: navigate to **系统设置 → 微信小程序**, fill in AppID and AppSecret, then save.

## 7. Common issues

| Symptom | What to check |
|--------|----------------|
| **Connection refused** to rule engine | Rule engine running; `RULE_ENGINE_URL` matches host/port (e.g. `http://127.0.0.1:8000`). |
| **CORS errors** | Rule engine should allow the web origin only; ensure FastAPI CORS includes your Next dev origin (e.g. `http://localhost:3000`). |
| **poppler / pdf2image errors** | Install poppler (`brew install poppler` on macOS); ensure `PAGE_RASTER_DPI` is reasonable. |
| **PostgreSQL / migrate** | `supabase start`; `DATABASE_URL` matches `supabase status` in **both** `apps/web/.env` and `services/rule_engine/.env`; run `npx prisma migrate deploy` (or `migrate dev`) in `apps/web`. |
| **Rule engine exits on startup** | Set `DATABASE_URL=postgresql://...` for the engine (see `services/rule_engine/.env.example`). SQLite checkpoints are not supported. |
| **Gemini / AI errors** | Configure **`/models`** in the web app: valid API key, slots saved, models allowed for that slot. Enable **Generative Language API** billing as needed. The rule engine does not use `GOOGLE_API_KEY` from `services/rule_engine/.env` for BFF-driven calls. |
| **Port already in use** | Change `--port` for uvicorn or Next’s port via `-p` / `PORT`. |
| **Prisma / DB errors** | `DATABASE_URL` correct; run `prisma migrate dev` after schema changes. |
| **WeChat login returns 503** | WeChat AppID / AppSecret not configured. Open `/settings` → 微信小程序 and fill them in. |
| **Chat returns 429** | Daily quota reached for that openid. Adjust `dailyChatLimit` in `/settings` → 微信小程序 (set to `0` to disable during testing), or wait until UTC midnight for the counter to reset. |
| **Rate limit not triggering** | `RateLimit` table missing — run `npx prisma migrate deploy` in `apps/web`. |

## 8. Further reading

- [services/rule_engine/README.md](./services/rule_engine/README.md) — Python tooling and running the engine in isolation.
- [services/rule_engine/EXTRACTION_FLOW.md](./services/rule_engine/EXTRACTION_FLOW.md) — extract pipeline, diagrams, and how index/chat consume outputs.
- Web **AI Gateway** UI: **`/models`** (credentials + Flash / Pro / Embed / Chat slots).
