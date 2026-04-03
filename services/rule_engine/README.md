# Rule engine service

Python service for board-game rule extraction: **PDF → per-page images** (`pdf2image` + poppler) or ordered images, **Gemini vision** chapter extraction, **LangGraph** orchestration (TOC → routing → batching → merge/refine → quick start and suggested questions), and **LlamaIndex** per-game indexing behind `POST /build-index` (dense vectors in **PostgreSQL + pgvector** when configured, else on-disk `VectorStoreIndex`, plus **BM25**, **RRF fusion**, **cross-encoder rerank**).

## Requirements

- **Python 3.11+**
- **poppler** (system) for `pdf2image` when rasterizing PDFs.
- Virtual environment recommended (`.venv` in this directory or managed by `uv`).

## Environment variables

Copy the example file and edit values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `GOOGLE_API_KEY` | Gemini API for Flash/Pro (vision + text). |
| `DATABASE_URL` | **Required** `postgresql://` — **PostgresSaver** for LangGraph checkpoints and **pgvector** for `POST /build-index` when enabled (set `USE_PGVECTOR=false` to keep vectors on disk). Same Postgres as **`apps/web`** (**Supabase** local or hosted); see **QUICKSTART.md**. Optional: `RULE_ENGINE_CHECKPOINT_URL` if checkpoints should use a different URL. |
| `LANGCHAIN_TRACING_V2` | Set to `true` to send traces to LangSmith. |
| `LANGCHAIN_API_KEY` | LangSmith API key when tracing is enabled. |
| `LANGCHAIN_PROJECT` | Project name in LangSmith (e.g. `boardrule-rag`). |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by CORS (default `http://localhost:3000`). |
| `PAGE_RASTER_DPI` / `PAGE_RASTER_MAX_SIDE` | PDF rasterization for `/extract/pages`. |
| `GEMINI_FLASH_MODEL` / `GEMINI_PRO_MODEL` | Optional model overrides for Flash vs Pro (Pro must support images). |
| `GEMINI_CHAT_MODEL` / `GEMINI_CHAT_TEMPERATURE` / `GEMINI_CHAT_MAX_TOKENS` | Phase 3 `POST /chat` synthesis (defaults: chat model follows `GEMINI_FLASH_MODEL` or `gemini-2.0-flash`, temperature `0.2`, max tokens `8192`). |
| `INDEX_STORAGE_ROOT` | BM25 + manifests (default `data/indexes/` under this service). |
| `GEMINI_EMBEDDING_MODEL` / `EMBEDDING_DIM` | Gemini embedding id and dimension for pgvector / indexing. |
| `RERANK_MODEL` | SentenceTransformers cross-encoder for reranking (default `cross-encoder/ms-marco-MiniLM-L-6-v2`). |

Prefer **`.env.example`** as the authoritative list when in doubt.

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
uv sync
```

Use whatever install command your `pyproject.toml` documents; the repo root **QUICKSTART.md** mirrors high-level steps.

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

Disable by unsetting `LANGCHAIN_TRACING_V2` or setting it to `false`.

## API surface

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/health` | Liveness. |
| `POST` | `/extract/pages` | Multipart: `game_id`, `file` or `file_url` or multiple `files` — rasterize to PNGs; returns `job_id` and per-page `url` under `/page-assets/...`。 |
| `POST` | `/extract` | Multipart: `game_id`, `page_job_id`, `toc_page_indices`, `exclude_page_indices` (JSON array strings), optional `game_name`, `terminology_context`; optional `resume` + `job_id`。轮询 `GET /extract/{job_id}`。 |
| `POST` | `/build-index` | JSON: `game_id`, and **`merged_markdown` or `documents[]`**, optional `source_file`。BM25 + manifest on disk; vectors in pgvector or disk per `DATABASE_URL` / `USE_PGVECTOR`。 |
| `GET` | `/index/{game_id}/manifest` | 返回已建索引的 manifest，无则 `manifest: null`。 |
| `GET` | `/index/{game_id}/smoke-retrieve` | 开发烟测：query 参数 `q`，走 hybrid + rerank，返回带 `pages` / `source_file` 等 metadata 的片段。 |
| `POST` | `/chat` | Phase 3：JSON `game_id`, `message`, 可选 `messages`（仅历史轮次）。需已 `POST /build-index`；LlamaIndex `RetrieverQueryEngine`（hybrid + rerank + Gemini）。 |

Request/response models live in `api/routers/extract.py`, `api/routers/index.py`, and `api/routers/chat.py`.

### Prompt placeholders（`{{GAME_NAME}}` / `{{TERM_CONTEXT}}`）

模板里的占位符由 `utils/prompt_context.fill_prompt_placeholders()` 根据 `ExtractionState` 在运行时替换。

| Placeholder | 含义 | 来源 |
|-------------|------|------|
| `{{GAME_NAME}}` | 展示用游戏名 | `POST /extract` 表单字段 `game_name`；未传则用 `game_id`。 |
| `{{TERM_CONTEXT}}` | 注入到 `rule_style_core` 的「术语规范」正文 | `POST /extract` 表单字段 **`terminology_context`**（由调用方传入，例如 `apps/web` 在请求前从知识库检索、或运营粘贴《桌游通用术语》等片段）。**未传或仅空白**时，使用 `utils/prompt_context.terminology_block()` 中的默认说明字符串，而不是留空。 |

本服务 **不会**在引擎内部自动做类似 Dify「知识检索」节点的 RAG；若需要术语库，应在 **`POST /extract` 调用链上游** 拼好 `terminology_context` 再提交。

## Layout

```text
services/rule_engine/
  api/              # FastAPI app and routers
  graphs/           # LangGraph state and nodes
  ingestion/        # Page raster, node builders, index_builder, rulebook_query (Phase 3 Q&A)
  prompts/          # Markdown prompts (e.g. rule_style_core, toc_analyzer, chapter_extract_strict)
  utils/            # Gemini client, pagination, retries, progress
  eval/             # Fixtures and evaluation notes
```

## Troubleshooting

- **Import errors**: Run installs from `services/rule_engine` with the virtualenv activated; ensure `PYTHONPATH` matches the package layout if you run modules manually.
- **PDF rasterization**: Ensure poppler is installed; check `PAGE_RASTER_DPI` if pages fail to render.
- **Long jobs**: Extraction is asynchronous; clients should poll job status rather than relying on long HTTP timeouts.
- **PostgreSQL required**: The API does not start without `DATABASE_URL` (or `RULE_ENGINE_CHECKPOINT_URL`) pointing at PostgreSQL; local SQLite checkpoints were removed.

For full-stack local setup (web + engine), see the repository root **[QUICKSTART.md](../../QUICKSTART.md)**.
