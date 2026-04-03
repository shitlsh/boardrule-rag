-- pgvector (used by services/rule_engine when DATABASE_URL points at this Postgres)
CREATE EXTENSION IF NOT EXISTS vector;

-- Raw rulebook uploads (intermediate; cleared after successful extraction in apps/web)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rulebook-raw', 'rulebook-raw', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Exported markdown / JSON (long-lived; keys e.g. games/<gameId>/exports/rules.md)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('game-exports', 'game-exports', false, 52428800)
ON CONFLICT (id) DO NOTHING;
