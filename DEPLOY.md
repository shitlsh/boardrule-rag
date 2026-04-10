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

- **Transaction pooler** (PgBouncer, often port **6543** / pooler hostname) — good for **runtime** app traffic (Prisma in Next.js, serverless). For **`services/rule_engine`** LangGraph checkpoints, the app uses a **psycopg connection pool** (not a single long-lived connection), disables prepared statements, and sets TCP keepalives — long Gemini calls no longer leave one idle DB connection that the server closes. If you still see DB errors, switch the engine’s **`DATABASE_URL`** to **direct** (5432).
- **Direct** connection (often port **5432**, session mode or direct host) — use for **`prisma migrate deploy`** and for DDL that poolers may not handle well.

Set **`DATABASE_URL`** in each environment to match the intended use. For CI migration jobs, prefer the **direct** URL in secrets (often labeled “Session” or “Direct” in the Supabase dashboard).

## 2. GitHub Actions

- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)** — on pull requests and `master`: lint/build `apps/web`, build H5 `apps/miniapp`, `ruff` + `pytest` for `services/rule_engine`. The **`web` job** sets placeholder `DATABASE_URL`, `SUPABASE_*`, `AUTH_SECRET`, `AI_CONFIG_SECRET`, `MINIAPP_JWT_SECRET`, `RULE_ENGINE_URL` so `next build` can run (see workflow file); it does not talk to real Supabase or the rule engine.
- **[`.github/workflows/migrate.yml`](.github/workflows/migrate.yml)** — optional automation for hosted DB: Supabase CLI `db push`, then `prisma migrate deploy` (runs on pushes to `master` when migration paths change, or `workflow_dispatch`).  
  - **`SUPABASE_ACCESS_TOKEN`**: Supabase **account** [Personal Access Token](https://supabase.com/dashboard/account/tokens) — must look like `sbp_0102…1920`. **Not** the project **service_role** / **anon** keys (those are JWTs for your app).  
  - **`SUPABASE_PROJECT_REF`**: project ref from **Dashboard → Project Settings → General**.  
  - **`DATABASE_URL`**: direct Postgres URL (same idea as Prisma).  
  You can also run the same commands locally with `supabase link` + `supabase db push`.
- **[`.github/workflows/seed-admin.yml`](.github/workflows/seed-admin.yml)** — **manual** run: first admin user via `npm run seed:admin`. Reuses the same **`DATABASE_URL`** secret as `migrate.yml`; add **`SEED_ADMIN_EMAIL`** and **`SEED_ADMIN_PASSWORD`** (optional **`SEED_ADMIN_NAME`**). Run from **Actions → Seed admin user → Run workflow** so you do not need the production connection string on a local machine.

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

**First admin user:** the app does not create one at deploy time. After migrations, either run **[`seed-admin.yml`](.github/workflows/seed-admin.yml)** in GitHub Actions (recommended if `DATABASE_URL` is already a secret for migrations), or insert into `next_auth.users` manually (e.g. Supabase SQL Editor with a bcrypt hash). The script [`apps/web/scripts/seed-admin.cjs`](apps/web/scripts/seed-admin.cjs) is idempotent and documents the expected columns.

## 4. Hugging Face Space (`services/rule_engine`)

### Repository layout for Hub

- The Space repository only needs the **`services/rule_engine`** tree at its **root** (Dockerfile, `api/`, `pyproject.toml`, etc.). GitHub Actions uses **`git subtree split --prefix=services/rule_engine`** and force-pushes that history to the Space — no symlink or extra Dockerfile at the monorepo root.
- Space metadata (`sdk: docker`, `app_port`, …) lives in the YAML frontmatter at the top of [`services/rule_engine/README.md`](services/rule_engine/README.md).
- [`services/rule_engine/Dockerfile`](services/rule_engine/Dockerfile) expects the Docker **build context** to be **`services/rule_engine`** (paths are `COPY api ./api`, etc.). Local check from monorepo root:

  ```bash
  docker build -f services/rule_engine/Dockerfile ./services/rule_engine
  ```

### Create the Space

- **Web:** [Create new Space](https://huggingface.co/new-space) — SDK **Docker**, name it under your namespace (e.g. `youruser/your-space`).
- **CLI** (with [`hf`](https://huggingface.co/docs/huggingface_hub/guides/cli) and `HF_TOKEN`): `hf repos create youruser/your-space --type space --space-sdk docker --exist-ok`

### Sync from GitHub (recommended)

Workflow **[`.github/workflows/sync-to-hf-space.yml`](.github/workflows/sync-to-hf-space.yml)** runs on pushes to **`master`** that touch **`services/rule_engine/**` (or on **workflow_dispatch**). It subtree-splits that folder and pushes to the Space.

1. In the GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - **Secret** `HF_TOKEN`: Hugging Face [access token](https://huggingface.co/settings/tokens) with **write** access.
2. Under **Variables**, add **`HF_SPACE_ID`** = `namespace/space-name` (same path as `https://huggingface.co/spaces/<namespace>/<space-name>`).
3. Optional: **`HF_SPACE_BRANCH`** — branch name on the Hub (default **`main`**). Use if your Space uses a different default branch.
4. Push to `master` with changes under `services/rule_engine/`, or run the workflow manually (**Actions → Sync to Hugging Face Space → Run workflow**).

If the workflow is skipped, ensure both `HF_TOKEN` and `HF_SPACE_ID` are set.

### Runtime configuration (Space dashboard)

Set **Variables and secrets** on the Space (not in GitHub) for the running container:

- `DATABASE_URL`, `CORS_ORIGINS` (your Vercel web origin), optional `RULE_ENGINE_API_KEY` to match `apps/web`, and Supabase vars if using **remote index bundles** (`INDEX_STORAGE_MODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INDEX_STORAGE_BUCKET`). Provider API keys stay in the web app; the engine uses `X-Boardrule-Ai-Config` (v2) from the BFF.

- Default listen port follows Hugging Face’s **`PORT`** environment variable (the Dockerfile uses it).

### Point `apps/web` at the Space

Set **`RULE_ENGINE_URL`** in Vercel (and local `.env` when testing) to the Space origin, e.g. `https://youruser-your-space.hf.space` (no trailing slash). Verify: `GET https://…/health`.

## 5. Rule engine index bundles (Supabase Storage)

For serverless or ephemeral disks (e.g. HF Spaces), configure **Supabase Storage** so BM25 + on-disk vector snapshots + `manifest.json` are stored as a zip per game. See [`services/rule_engine/README.md`](services/rule_engine/README.md) and `INDEX_STORAGE_*` in [`services/rule_engine/.env.example`](services/rule_engine/.env.example). The bucket `boardrule-indexes` is created by Supabase migrations.

**Note:** Indexes that use **pgvector** still store vectors in PostgreSQL; the bundle holds BM25 artifacts and manifest (and disk vector files when `vector_backend` is `disk`).
