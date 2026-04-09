# Build context must be this directory (the rule_engine package root):
#   docker build -f Dockerfile .
# From monorepo root:
#   docker build -f services/rule_engine/Dockerfile ./services/rule_engine
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
COPY api ./api
COPY graphs ./graphs
COPY ingestion ./ingestion
COPY utils ./utils
COPY prompts ./prompts
COPY langgraph.json ./langgraph.json

RUN pip install --no-cache-dir -U pip \
    && pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
ENV PORT=7860

CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
