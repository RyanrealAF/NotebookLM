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
