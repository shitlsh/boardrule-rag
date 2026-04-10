# boardrule-rag

Board-game rule extraction and RAG: ingest rule books (PDF/images), rasterize pages for **Gemini vision** extraction via LangGraph, optional human TOC/exclude confirmation in the web UI, then build per-game indexes (PostgreSQL + pgvector when configured, else on-disk vectors) for grounded Q&A with page references.

This repository is the **single** codebase and product surface: a monorepo with **`apps/web`** (Next.js App Router, TypeScript) and **`services/rule_engine`** (Python 3.11+, FastAPI, LangGraph, LlamaIndex).

## Relationship to the older demo

The **`dify-boardgame-rule-agent`** project is **not** integrated here. Treat it only as a **reference** for business behavior (metadata, uploads, async tasks, extraction outputs, admin UX). Features here are reimplemented; there is **no** Dify dependency, dataset IDs, or dual-backend compatibility.

## Repository layout (target)

```text
boardrule-rag/
  apps/web/                 # Next.js admin UI + BFF, Prisma, task APIs
  apps/miniapp/             # uni-app C 端（默认 H5；可选微信小程序）— 见 apps/miniapp/README.md
  services/rule_engine/     # FastAPI, LangGraph extraction, LlamaIndex, Gemini vision
  docs/                     # Optional extra docs (see QUICKSTART.md at repo root)
```

Details evolve with implementation; **`QUICKSTART.md`** stays the source of truth for install, env vars, and how to run services locally.

## Components

| Area | Role |
|------|------|
| **apps/web** | Game metadata, rule uploads, task polling, extraction status; calls the rule engine via `RULE_ENGINE_URL` only. **API keys** (Google Gemini or OpenRouter) and per-slot models are configured in the UI (`/models`) and sent as **`X-Boardrule-Ai-Config`** (v2, `slots`) to the engine (see **QUICKSTART.md**). |
| **services/rule_engine** | `POST /extract/pages` (rasterize), `POST /extract` (vision pipeline + checkpoints), `POST /build-index/start` + `GET /build-index/jobs/{id}`, `POST /chat`, `GET /health`. |

## Tech stack (fixed)

- **Runtime**: Python **3.11+** (`services/rule_engine`).
- **Web**: **Next.js** App Router, **TypeScript** (`apps/web`).
- **Data**: **Prisma ORM 7** (`prisma.config.ts`); **PostgreSQL + pgvector** via **Supabase** (local `supabase start` or hosted). **Supabase Storage** (S3-compatible) for rule uploads and exports when configured — see **QUICKSTART.md**.
- **Ingestion**: **pdf2image** + **poppler** (system) for PDF page renders; ordered images also supported.
- **Orchestration**: **LangGraph** with checkpointing (**PostgreSQL** via `DATABASE_URL`).
- **RAG**: **LlamaIndex** (Phase 2: hybrid retrieval + rerank).
- **LLM**: **Gemini** — credentials and Flash / Pro / Embed / Chat slots are configured in **`apps/web`** (`/models`), not in `services/rule_engine/.env`.
- **Observability**: **LangSmith** (optional tracing).

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** — clone, dependencies, `.env`, ports, health check, and troubleshooting.
- **[DEPLOY.md](./DEPLOY.md)** — production migrations order, GitHub Actions, Vercel, Hugging Face Spaces, index bundles in Storage.
- **[apps/miniapp/README.md](./apps/miniapp/README.md)** — C 端 H5 / 小程序、本地调试与 Vercel 静态部署入口。
- **[services/rule_engine/README.md](./services/rule_engine/README.md)** — Python env, running the API alone, LangSmith toggles.

## Syncing `.env` with `.env.example`

When `.env.example` gains new keys or comments, use **[scripts/env-sync.sh](./scripts/env-sync.sh)** to refresh your local `.env` **without overwriting existing variable values** (same idea as [Dify’s `dify-env-sync.sh`](https://github.com/langgenius/dify/blob/main/docker/dify-env-sync.sh)): the script writes a new `.env` following `.env.example`’s line order, keeps any `KEY=value` already present in `.env`, fills missing keys from the example, and saves a timestamped backup under `env-backup/`.

```bash
chmod +x scripts/env-sync.sh   # once
./scripts/env-sync.sh            # default: apps/web
./scripts/env-sync.sh services/rule_engine
./scripts/env-sync.sh --all      # both apps/web and services/rule_engine
./scripts/env-sync.sh --help
```

If `.env` does not exist yet, the script copies `.env.example` to `.env`.

## License

See [LICENSE](./LICENSE).
