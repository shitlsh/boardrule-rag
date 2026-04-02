# boardrule-rag

Board-game rule extraction and RAG: ingest rule books (PDF/images), parse with LlamaParse, extract structured Markdown via LangGraph, and (in later phases) build per-game indexes for grounded Q&A with page references.

This repository is the **single** codebase and product surface: a monorepo with **`apps/web`** (Next.js 14, App Router, TypeScript) and **`services/rule_engine`** (Python 3.11+, FastAPI, LangGraph, LlamaIndex).

## Relationship to the older demo

The **`dify-boardgame-rule-agent`** project is **not** integrated here. Treat it only as a **reference** for business behavior (metadata, uploads, async tasks, extraction outputs, admin UX). Features here are reimplemented; there is **no** Dify dependency, dataset IDs, or dual-backend compatibility.

## Repository layout (target)

```text
boardrule-rag/
  apps/web/                 # Next.js admin UI, Prisma, task APIs
  services/rule_engine/     # FastAPI, LangGraph extraction, LlamaParse, LlamaIndex
  docs/                     # Optional extra docs (see QUICKSTART.md at repo root)
```

Details evolve with implementation; **`QUICKSTART.md`** stays the source of truth for install, env vars, and how to run services locally.

## Components

| Area | Role |
|------|------|
| **apps/web** | Game metadata, rule uploads, task polling, extraction status; calls the rule engine via `RULE_ENGINE_URL` only. |
| **services/rule_engine** | `POST /extract` (async + checkpoints), `POST /build-index` (per-game dense + BM25 + rerank), `GET /health`; Phase 3 optional chat APIs. |

## Tech stack (fixed)

- **Runtime**: Python **3.11+** (`services/rule_engine`).
- **Web**: **Next.js 14** App Router, **TypeScript** (`apps/web`).
- **Data**: **Prisma ORM 7** (`prisma.config.ts`, SQLite via `better-sqlite3` adapter in dev); PostgreSQL recommended in production.
- **Parsing**: **LlamaParse** (`LLAMA_CLOUD_API_KEY`).
- **Orchestration**: **LangGraph** with checkpointing (SQLite in dev, Postgres in production).
- **RAG**: **LlamaIndex** (Phase 2: hybrid retrieval + rerank).
- **LLM**: **Gemini** (Flash / Pro roles as configured in the service).
- **Observability**: **LangSmith** (optional tracing).

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** — clone, dependencies, `.env`, ports, health check, and troubleshooting.
- **[services/rule_engine/README.md](./services/rule_engine/README.md)** — Python env, running the API alone, LangSmith toggles.

## License

See [LICENSE](./LICENSE).
