# Quickstart

Follow these steps after cloning **`boardrule-rag`** to run the stack locally. Keep this file in sync when ports, scripts, or environment variables change.

## Prerequisites

- **Git**
- **Python 3.11+** (for `services/rule_engine`)
- **Node.js 18+** (LTS recommended; for `apps/web` when present)
- **pnpm**, **npm**, or **yarn** (match whatever the `apps/web` package manager ends up using once `package.json` exists)

Optional:

- **PostgreSQL** for production-like Prisma / LangGraph checkpointing (SQLite is fine for local dev until you configure otherwise).

## 1. Clone the repository

```bash
git clone <your-fork-or-upstream-url> boardrule-rag
cd boardrule-rag
```

## 2. Rule engine (`services/rule_engine`)

### 2.1 Create environment file

Copy the example env file:

```bash
cp services/rule_engine/.env.example services/rule_engine/.env
```

Edit `services/rule_engine/.env` and set at least the keys in the table below.

### 2.2 Environment variables (rule engine)

| Variable | Required | Description |
|----------|----------|-------------|
| `LLAMA_CLOUD_API_KEY` | Yes (for extraction) | LlamaParse / Llama Cloud API key. |
| `GOOGLE_API_KEY` | Yes (for LLM calls) | Google AI / Gemini API key. |
| `LANGCHAIN_TRACING_V2` | No | Set to `true` to enable LangSmith tracing. |
| `LANGCHAIN_API_KEY` | If tracing | LangSmith API key. |
| `LANGCHAIN_PROJECT` | No | Defaults to `boardrule-rag` in docs; set to group runs in LangSmith. |
| `LANGCHAIN_ENDPOINT` | No | Override only if your LangSmith deployment requires it. |

Add any service-specific variables introduced in `services/rule_engine/.env.example` (for example host/port or checkpoint DSN) as the codebase grows.

### 2.3 Install and run

After `pyproject.toml` is added to this service, from the repo root:

```bash
cd services/rule_engine
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"     # or: uv sync — see services/rule_engine/README.md
```

Start the API (default dev port **8000**; exact module path follows the implemented package layout):

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

If those files are not present yet, skip install/run until the `phase1-python-service` milestone lands.

**Health check:**

```bash
curl -s http://127.0.0.1:8000/health
```

## 3. Web app (`apps/web`)

When `apps/web` is present:

### 3.1 Environment variables (web)

Create `apps/web/.env` (or `.env.local`) from any `.env.example` in that app.

| Variable | Required | Description |
|----------|----------|-------------|
| `RULE_ENGINE_URL` | Yes | Base URL of the rule engine, e.g. `http://localhost:8000`. The frontend must call **only** this backend (no Dify keys). |
| Database URL | Yes | Prisma `DATABASE_URL` (e.g. SQLite file for dev). |
| Storage | As implemented | Paths or object-storage keys for uploaded rules and exported artifacts—follow `apps/web` docs when added. |

### 3.2 Install and run

```bash
cd apps/web
npm install          # or pnpm install / yarn
npx prisma migrate dev   # when schema exists
npm run dev          # default Next.js port is usually 3000
```

Open `http://localhost:3000` (or the port shown in the terminal).

## 4. End-to-end smoke test

1. Rule engine responds on `GET /health`.
2. With keys set, trigger `POST /extract` (or the admin UI upload flow) using a small PDF once the route is implemented.
3. Confirm the web app shows task status and `extractionJobId` / `extractionStatus` as designed.

## 5. Common issues

| Symptom | What to check |
|--------|----------------|
| **Connection refused** to rule engine | Rule engine running; `RULE_ENGINE_URL` matches host/port (e.g. `http://127.0.0.1:8000`). |
| **CORS errors** | Rule engine should allow the web origin only; ensure FastAPI CORS includes your Next dev origin (e.g. `http://localhost:3000`). |
| **`LLAMA_CLOUD_API_KEY` invalid** | Key in Llama Cloud dashboard; no extra quotes or spaces in `.env`. |
| **Gemini / `GOOGLE_API_KEY` errors** | Billing and API enablement for the Generative Language API in Google Cloud. |
| **Port already in use** | Change `--port` for uvicorn or Next’s port via `-p` / `PORT`. |
| **Prisma / DB errors** | `DATABASE_URL` correct; run `prisma migrate dev` after schema changes. |

## 6. Further reading

- [services/rule_engine/README.md](./services/rule_engine/README.md) — Python tooling and running the engine in isolation.
