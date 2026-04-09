-- Private bucket for rule_engine per-game index bundles (BM25 + manifest + optional disk vectors zip).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('boardrule-indexes', 'boardrule-indexes', false, 536870912)
ON CONFLICT (id) DO NOTHING;
