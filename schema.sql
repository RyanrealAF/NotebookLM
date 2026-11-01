-- Table for full chunk hydration
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  section_path TEXT
);

-- Full-Text Search 5 (FTS5) table for lexical matching
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED,
  notebook_id UNINDEXED,
  content
);

-- Indexes for scoped search and re-ingest lookups (notebook_id filter
-- in search, notebook_id + doc_id lookup when replacing a document).
-- For an existing database, apply these from
-- migrations/0002_chunk_indexes.sql instead; re-running schema.sql
-- will NOT add them, because CREATE TABLE IF NOT EXISTS is a no-op
-- on tables that already exist.
CREATE INDEX IF NOT EXISTS idx_chunks_notebook_id ON chunks(notebook_id);
CREATE INDEX IF NOT EXISTS idx_chunks_notebook_doc ON chunks(notebook_id, doc_id);
