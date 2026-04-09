# Hugging Face Spaces / any Docker host: build from the repository root:
#   docker build -f services/rule_engine/Dockerfile .
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/rule_engine/pyproject.toml services/rule_engine/README.md ./
COPY services/rule_engine/api ./api
COPY services/rule_engine/graphs ./graphs
COPY services/rule_engine/ingestion ./ingestion
COPY services/rule_engine/utils ./utils
COPY services/rule_engine/prompts ./prompts
COPY services/rule_engine/langgraph.json ./langgraph.json

RUN pip install --no-cache-dir -U pip \
    && pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
ENV PORT=7860

CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
