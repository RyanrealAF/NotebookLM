-- Migration 0002: chunk lookup indexes for an EXISTING notebook-db.
-- Run this in the D1 dashboard Console (or via wrangler d1 execute).
-- It is safe to run twice: both statements use IF NOT EXISTS.
-- It does NOT recreate tables and does NOT add the title column;
-- if your database was created from the guide schema, run this
-- separately for titles before seeding ingested documents:
--   ALTER TABLE chunks ADD COLUMN title TEXT;

CREATE INDEX IF NOT EXISTS idx_chunks_notebook_id ON chunks(notebook_id);
CREATE INDEX IF NOT EXISTS idx_chunks_notebook_doc ON chunks(notebook_id, doc_id);
