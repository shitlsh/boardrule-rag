# Deployment (production)

This document complements **[QUICKSTART.md](./QUICKSTART.md)** with hosted setup: migration order, connection strings, Vercel, Hugging Face Spaces, and GitHub Actions.

## 1. Database migrations (order matters)

Two layers apply to the **same** PostgreSQL database (Supabase hosted or local):

1. **Supabase SQL** — under [`supabase/migrations/`](supabase/migrations/). Applies extensions (e.g. `vector`), storage buckets, and platform-level SQL.  
   - Local: applied when you run `supabase start` / `supabase db reset`.  
   - Hosted: use Supabase CLI against the linked project, e.g. `supabase db push` (see [Supabase CLI](https://supabase.com/docs/guides/cli)).

2. **Prisma** — under [`apps/web/prisma/migrations/`](apps/web/prisma/migrations/). Creates and updates application tables in the `app` schema (and related).  
   - Run from [`apps/web`](apps/web):  
     `npx prisma migrate deploy`  
   - Use a **direct** Postgres connection string for migrations (see below).

**Always run Supabase SQL migrations before Prisma** on a new environment or when both change.

### Connection strings: pooler vs direct

Supabase offers:

- **Transaction pooler** (PgBouncer, often port **6543** / pooler hostname) — good for **runtime** app traffic (Prisma in Next.js, serverless).
- **Direct** connection (often port **5432**, session mode or direct host) — use for **`prisma migrate deploy`** and for DDL that poolers may not handle well.

Set **`DATABASE_URL`** in each environment to match the intended use. For CI migration jobs, prefer the **direct** URL in secrets (often labeled “Session” or “Direct” in the Supabase dashboard).

## 2. GitHub Actions

- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)** — on pull requests and `main`: lint/build `apps/web`, build H5 `apps/miniapp`, `ruff` + `pytest` for `services/rule_engine`.
- **[`.github/workflows/migrate.yml`](.github/workflows/migrate.yml)** — optional automation for hosted DB: Supabase CLI `db push`, then `prisma migrate deploy`. Configure repository secrets (see workflow file). You can also run the same commands locally with a linked project.

**Vercel and Hugging Face** deploy via each platform’s **Git integration** (push to the default branch); this repo does not use GitHub Actions to deploy those surfaces.

## 3. Vercel (`apps/web` and `apps/miniapp`)

Configure **two Vercel projects** from the same GitHub repo:

| Setting | `apps/web` | `apps/miniapp` |
|--------|------------|----------------|
| Root Directory | `apps/web` | `apps/miniapp` |
| Framework | Next.js (auto) | Other / static per existing [`vercel.json`](apps/miniapp/vercel.json) |
| Node.js | **20.19+** (match [`apps/web/package.json`](apps/web/package.json) `engines`) | (build uses Node for uni-app CLI) |

Set environment variables in the Vercel dashboard (Production / Preview as needed), including:

- `DATABASE_URL`, `NEXTAUTH_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RULE_ENGINE_URL`, `AI_CONFIG_SECRET`, etc. (see [`apps/web/.env.example`](apps/web/.env.example)).
- Miniapp build: `VITE_BFF_BASE_URL` = your deployed web app origin (see [`apps/miniapp/src/utils/env.ts`](apps/miniapp/src/utils/env.ts)).

After **schema changes**, run migrations (§1) **before** relying on a new Vercel deployment that expects the new columns.

## 4. Hugging Face Space (`services/rule_engine`)

- Create a **Docker** Space and connect this GitHub repository.
- Build context must be the **repository root** so paths match the Dockerfile. Use:

  ```bash
  docker build -f services/rule_engine/Dockerfile .
  ```

- Set **Secrets** in the Space: `DATABASE_URL`, `CORS_ORIGINS` (your Vercel web origin), optional `RULE_ENGINE_API_KEY` to match `apps/web`, and Supabase vars if using **remote index bundles** (`INDEX_STORAGE_MODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INDEX_STORAGE_BUCKET`). Gemini keys stay in the web app; the engine uses `X-Boardrule-Ai-Config` from the BFF.

- Default listen port follows Hugging Face’s **`PORT`** environment variable (the Dockerfile uses it).

## 5. Rule engine index bundles (Supabase Storage)

For serverless or ephemeral disks (e.g. HF Spaces), configure **Supabase Storage** so BM25 + on-disk vector snapshots + `manifest.json` are stored as a zip per game. See [`services/rule_engine/README.md`](services/rule_engine/README.md) and `INDEX_STORAGE_*` in [`services/rule_engine/.env.example`](services/rule_engine/.env.example). The bucket `boardrule-indexes` is created by Supabase migrations.

**Note:** Indexes that use **pgvector** still store vectors in PostgreSQL; the bundle holds BM25 artifacts and manifest (and disk vector files when `vector_backend` is `disk`).
