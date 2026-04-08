# Rule engine service

Python service for board-game rule extraction: **PDF → per-page images** (`pdf2image` + poppler) or ordered images, **Gemini vision** chapter extraction, **LangGraph** orchestration (TOC → routing → batching → merge/refine → quick start and suggested questions), and **LlamaIndex** per-game indexing behind **`POST /build-index/start`** (poll **`GET /build-index/jobs/{job_id}`** until `completed`; dense vectors in **PostgreSQL + pgvector** when configured, else on-disk `VectorStoreIndex`, plus **BM25**, **RRF fusion**, **cross-encoder rerank**).

### Vision-only extraction

Rule extraction **requires** rasterized page images from **`POST /extract/pages`** (and `POST /extract` with `page_job_id`). The graph uses **`prompts/toc_analyzer_vision.md`** and **`prompts/chapter_extract_vision.md`** only. The API validates that every **TOC** and **body** page index has a non-empty image path in `page_rows`.

## Requirements

- **Python 3.11+**
- **poppler** (system) for `pdf2image` when rasterizing PDFs.
- Virtual environment recommended: **prefer a single `.venv` here** (`services/rule_engine/.venv`) and activate it before running this service. A second `.venv` at the monorepo root is a *different* environment unless you only use one of them — see **QUICKSTART.md** §3.2.5.

## Environment variables

Copy the example file and edit values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| *(none for Gemini keys)* | **Gemini API keys and models are not configured in this service.** The **`apps/web`** BFF sends header **`X-Boardrule-Ai-Config`** on `POST /extract`, `POST /build-index/start`, `POST /chat`, etc. Configure providers in the web app at **`/models`** (模型与凭证). |
| `DATABASE_URL` | **Required** `postgresql://` — **PostgresSaver** for LangGraph checkpoints and **pgvector** for indexing when enabled (set `USE_PGVECTOR=false` to keep vectors on disk). Same Postgres as **`apps/web`** (**Supabase** local or hosted); see **QUICKSTART.md**. Optional: `RULE_ENGINE_CHECKPOINT_URL` if checkpoints should use a different URL. |
| `LANGCHAIN_TRACING_V2` | Set to `true` to send traces to LangSmith. |
| `LANGCHAIN_API_KEY` | LangSmith API key when tracing is enabled. |
| `LANGCHAIN_PROJECT` | Project name in LangSmith (e.g. `boardrule-rag`). |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by CORS (default `http://localhost:3000`). |
| `PAGE_RASTER_DPI` / `PAGE_RASTER_MAX_SIDE` | PDF rasterization for `/extract/pages`. |
| `EXTRACTION_SIMPLE_MAX_BODY_PAGES` | Simple-profile gate: max **body** page count (default `10`; see `EXTRACTION_FLOW.md` §2.1). |
| `EXTRACTION_COMPLEX_ROUTE_BODY_PAGES` | Complex-profile only: `needs_batching` when body pages exceed this (default `15`). |
| `VISION_BATCH_PAGES` | Pages per vision batch when `needs_batching` is true (default `6`). |
| `INDEX_STORAGE_ROOT` | BM25 + manifests (default `data/indexes/` under this service). |
| `EMBEDDING_DIM` | Vector dimension for pgvector / indexing (must match the embedding model chosen in AI Gateway). |
| `RERANK_MODEL` | SentenceTransformers cross-encoder for reranking (default `BAAI/bge-reranker-base`). |

Prefer **`.env.example`** as the authoritative list (grouped by concern: HTTP, LangSmith, raster defaults, vision graph, chat, index, paths).

## Install

From `services/rule_engine`:

**pip / venv**

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

**uv** (if the project standardizes on it)

```bash
uv sync --extra dev
```

The `dev` extra includes **`langgraph-cli[inmem]`** for local LangGraph Studio (see below). Use whatever install command your `pyproject.toml` documents; the repo root **QUICKSTART.md** mirrors high-level steps.

## Run the API

Typical development command (adjust module path if your package layout differs):

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

Then:

```bash
curl http://127.0.0.1:8000/health
```

## LangSmith

Enable tracing for debugging and regression:

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your-langsmith-key
export LANGCHAIN_PROJECT=boardrule-rag
```

Disable by unsetting `LANGCHAIN_TRACING_V2` or setting it to `false`. When tracing is off, or the API key is missing, the rule engine does not open LangSmith runs around native Gemini (`google-genai`) calls.

When tracing is on **and** a LangSmith API key is set (`LANGCHAIN_API_KEY` or `LANGSMITH_API_KEY`), each Gemini call from graph nodes records a child **`llm`** run (via `langsmith.run_helpers.trace`) with metadata such as **`gemini_node`** (graph node name), **`prompt_file`** (template basename when applicable), **`prompt_sha256`** (hash of the rendered prompt or multimodal text parts), and optional **`call_tag`** (for example batch index or merge stage). This does not send full prompts to LangSmith—only hashes and short labels.

## Batching and concurrency

The graph **sequentially** calls Gemini once per batch **inside** a single node implementation: for example `chapter_extract` iterates over `vision_batches` in a `for` loop (vision-only; there are no text character batches), and `merge_and_refine` may issue multiple merge calls when outputs are long. That keeps memory use and API rate limits easy to reason about.

**End-to-end flow (Web → extract → index → chat):** see **[EXTRACTION_FLOW.md](./EXTRACTION_FLOW.md)**.

**Optional future work** (not implemented here): parallel batch requests with `asyncio.gather` plus a semaphore or token bucket for rate limiting, or refactoring to LangGraph **`Send`** so each batch is a mapped child run—either approach would require careful handling of ordering when assembling `chapter_outputs` and merged text.

## LangGraph Studio (CLI)

Use the official CLI to run the extraction graph against the **LangGraph dev API** and open **Studio** for a visual graph and step debugging. Configuration lives in **`langgraph.json`**; the exported graph is **`langgraph_studio.py`** (same `StateGraph` as production, compiled **without** `PostgresSaver` so Studio does not require a running database for the graph definition itself).

**Prerequisite:** `langgraph dev` imports `langgraph_studio.py`, which pulls in the full node stack (including `utils/gemini.py` and `google-genai`). The **same Python environment** that runs `langgraph` must have the rule engine installed in editable mode, not only `langgraph-cli`.

From the repository root (with your venv activated), either:

```bash
pip install -e "services/rule_engine/[dev]"
```

or from `services/rule_engine`:

```bash
pip install -e ".[dev]"
```

Then start Studio:

```bash
cd services/rule_engine
langgraph dev --config langgraph.json
```

The process prints a local API base URL (often `http://127.0.0.1:2024`). Open **LangGraph Studio** in the browser (the CLI may offer a link; default Studio host is documented in `langgraph dev --help` via `--studio-url`). If your browser or network blocks `localhost`, run with `--tunnel`.

This is **in addition to** the FastAPI server (`uvicorn api.main:app`, port **8000** by default). Studio uses its own port (commonly **2024**); they do not conflict.

## API surface

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/health` | Liveness. |
| `POST` | `/extract/pages` | Multipart: `game_id`, `file` or `file_url` or multiple `files` — rasterize to PNGs; returns `job_id` and per-page `url` under `/page-assets/...`。 |
| `POST` | `/extract` | Multipart: `game_id`, `page_job_id`, `toc_page_indices`, `exclude_page_indices` (JSON array strings), optional `game_name`, `terminology_context`; optional `resume` + `job_id`。轮询 `GET /extract/{job_id}`。 |
| `POST` | `/build-index/start` | JSON: `game_id`, and **`merged_markdown` or `documents[]`**, optional `source_file`。立即返回 `job_id`；后台建索引。轮询 **`GET /build-index/jobs/{job_id}`** 至 `completed` 或 `failed`。BM25 + manifest on disk; vectors in pgvector or disk per `DATABASE_URL` / `USE_PGVECTOR`。 |
| `GET` | `/build-index/jobs/{job_id}` | 异步建索引任务状态：`pending` / `processing` / `completed` / `failed`，成功时含 `manifest`。 |
| `GET` | `/index/{game_id}/manifest` | 返回已建索引的 manifest，无则 `manifest: null`。 |
| `GET` | `/index/{game_id}/smoke-retrieve` | 开发烟测：query 参数 `q`，走 hybrid + rerank，返回带 `pages` / `source_file` 等 metadata 的片段。 |
| `POST` | `/chat` | Phase 3：JSON `game_id`, `message`, 可选 `messages`（仅历史轮次）。需已为该 `game_id` 建立向量索引；LlamaIndex `RetrieverQueryEngine`（hybrid + rerank + Gemini）。 |

Request/response models live in `api/routers/extract.py`, `api/routers/index.py`, and `api/routers/chat.py`.

### Prompt placeholders（`{{GAME_NAME}}` / `{{TERM_CONTEXT}}`）

模板由 `utils/prompt_context.render_prompt()`（Jinja2）根据 `ExtractionState` 与额外变量在运行时渲染。

| Placeholder | 含义 | 来源 |
|-------------|------|------|
| `{{GAME_NAME}}` | 展示用游戏名 | `POST /extract` 表单字段 `game_name`；未传则用 `game_id`。 |
| `{{TERM_CONTEXT}}` | 注入到 `rule_style_core` 的「术语规范」正文 | `POST /extract` 表单字段 **`terminology_context`**（由调用方传入，例如 `apps/web` 在请求前从知识库检索、或运营粘贴《桌游通用术语》等片段）。**未传或仅空白**时，使用 `utils/prompt_context.terminology_block()` 中的默认说明字符串，而不是留空。 |

本服务 **不会**在引擎内部自动做类似 Dify「知识检索」节点的 RAG；若需要术语库，应在 **`POST /extract` 调用链上游** 拼好 `terminology_context` 再提交。

## Layout

```text
services/rule_engine/
  EXTRACTION_FLOW.md  # Extract → index → chat: diagrams and business steps
  langgraph.json    # LangGraph CLI: dependencies + graph entrypoint for Studio
  langgraph_studio.py  # `graph` export for `langgraph dev` (no Postgres checkpointer)
  api/              # FastAPI app and routers
  graphs/           # LangGraph state and nodes
  ingestion/        # Page raster, node builders, index_builder, rulebook_query (Phase 3 Q&A)
  prompts/          # Markdown prompts (vision TOC/chapter, merge, quickstart, chat, …)
  utils/            # Gemini client, pagination, retries, progress
  eval/             # Fixtures and evaluation notes
```

## Troubleshooting

- **`ModuleNotFoundError: No module named 'google.genai'`** (when running `langgraph dev`): The interpreter used by `langgraph` does not have the rule engine’s dependencies. Install the package into that venv: `pip install -e "services/rule_engine/[dev]"` from the repo root, or `pip install -e ".[dev]"` from `services/rule_engine`. Confirm with `python -c "from google import genai"` using the same `python` as `which langgraph` points to (or `python -m langgraph dev ...` to force the venv’s Python).
- **Import errors**: Run installs from `services/rule_engine` with the virtualenv activated; ensure `PYTHONPATH` matches the package layout if you run modules manually.
- **PDF rasterization**: Ensure poppler is installed; check `PAGE_RASTER_DPI` if pages fail to render.
- **Long jobs**: Extraction is asynchronous; clients should poll job status rather than relying on long HTTP timeouts.
- **PostgreSQL required**: The API does not start without `DATABASE_URL` (or `RULE_ENGINE_CHECKPOINT_URL`) pointing at PostgreSQL; local SQLite checkpoints were removed.

For full-stack local setup (web + engine), see the repository root **[QUICKSTART.md](../../QUICKSTART.md)**.
