-- pgvector (used by services/rule_engine when DATABASE_URL points at this Postgres)
CREATE EXTENSION IF NOT EXISTS vector;

-- Object storage bucket for rule uploads and extraction exports (keys match Game.*Path columns, e.g. games/<gameId>/exports/rules.md)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('game-assets', 'game-assets', false, 52428800)
ON CONFLICT (id) DO NOTHING;
