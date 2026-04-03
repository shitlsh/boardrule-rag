# boardrule-rag

Board-game rule extraction and RAG: ingest rule books (PDF/images), rasterize pages for **Gemini vision** extraction via LangGraph, optional human TOC/exclude confirmation in the web UI, then build per-game indexes (PostgreSQL + pgvector when configured, else on-disk vectors) for grounded Q&A with page references.

This repository is the **single** codebase and product surface: a monorepo with **`apps/web`** (Next.js 14, App Router, TypeScript) and **`services/rule_engine`** (Python 3.11+, FastAPI, LangGraph, LlamaIndex).

## Relationship to the older demo

The **`dify-boardgame-rule-agent`** project is **not** integrated here. Treat it only as a **reference** for business behavior (metadata, uploads, async tasks, extraction outputs, admin UX). Features here are reimplemented; there is **no** Dify dependency, dataset IDs, or dual-backend compatibility.

## Repository layout (target)

```text
boardrule-rag/
  apps/web/                 # Next.js admin UI, Prisma, task APIs
  services/rule_engine/     # FastAPI, LangGraph extraction, LlamaIndex, Gemini vision
  docs/                     # Optional extra docs (see QUICKSTART.md at repo root)
```

Details evolve with implementation; **`QUICKSTART.md`** stays the source of truth for install, env vars, and how to run services locally.

## Components

| Area | Role |
|------|------|
| **apps/web** | Game metadata, rule uploads, task polling, extraction status; calls the rule engine via `RULE_ENGINE_URL` only. |
| **services/rule_engine** | `POST /extract/pages` (rasterize), `POST /extract` (vision pipeline + checkpoints), `POST /build-index`, `POST /chat`, `GET /health`. |

## Tech stack (fixed)

- **Runtime**: Python **3.11+** (`services/rule_engine`).
- **Web**: **Next.js 14** App Router, **TypeScript** (`apps/web`).
- **Data**: **Prisma ORM 7** (`prisma.config.ts`); **PostgreSQL + pgvector** via **Supabase** (local `supabase start` or hosted). **Supabase Storage** (S3-compatible) for rule uploads and exports when configured — see **QUICKSTART.md**.
- **Ingestion**: **pdf2image** + **poppler** (system) for PDF page renders; ordered images also supported.
- **Orchestration**: **LangGraph** with checkpointing (**SQLite** or **PostgreSQL** via `DATABASE_URL`).
- **RAG**: **LlamaIndex** (Phase 2: hybrid retrieval + rerank).
- **LLM**: **Gemini** (Flash / Pro roles as configured in the service).
- **Observability**: **LangSmith** (optional tracing).

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** — clone, dependencies, `.env`, ports, health check, and troubleshooting.
- **[services/rule_engine/README.md](./services/rule_engine/README.md)** — Python env, running the API alone, LangSmith toggles.

## License

See [LICENSE](./LICENSE).
