// Single-user ingestion for the NotebookLM Hybrid Search Engine.
//
// POST /api/ingest takes one document (your own file/text, not a tenant
// upload), splits it into chunks, embeds each chunk with the SAME model
// used for search (bge-large-en-v1.5, 1024 dims), and upserts the chunks
// in parallel to Vectorize and D1 (chunks + chunks_fts).
//
// Re-ingesting the same notebookId + docId REPLACES that document:
// existing chunks for that doc are deleted from D1 and Vectorize first,
// so a shorter revised version does not leave stale chunks behind.
//
// Limits (to keep a single request inside Worker / AI / D1 bounds):
//   content: 200,000 characters max
//   chunks:  100 max (a longer document must be split by the caller first)
// Chunking is deterministic (no randomness) and markdown-header aware:
// a header starts a new chunk (its text becomes the chunk's section_path),
// and a section longer than ~400 words is split at that word boundary.
// No overlap: overlap helps recall in some systems, but it duplicates
// content in search results and doubles embedding cost, so it is
// deliberately off here. Add it later only if a real miss is traced
// to a chunk boundary.
//
// Metadata, when supplied, follows Ryan's Universal Document Header
// Template (TITLE, TYPE, DATE, PLATFORM, AUDIENCE, TONE,
// PRIMARY/SECONDARY THEMES, KEY ARGUMENT, CORE TENSION, REPURPOSING
// VECTORS). It is prepended to the text sent to the embedding model
// only — the stored chunk content stays the raw text, so search
// results display clean text, not the header block.
//
// Deliberately NOT adopted from a later proposal for this endpoint:
// per-chunk parallel AI calls (one batched AI call is cheaper and
// avoids rate-limit pressure), FTS inserts without deleting old rows
// on re-ingest (that duplicates FTS rows, since id is UNINDEXED, not
// a primary key), and a per-request PRAGMA foreign_keys (this schema
// has no foreign keys, so it would add latency for nothing).

import type { Env } from "./retriever";

// Universal Document Header Template fields. All optional: when no
// metadata is supplied, ingestion falls back to title + section only.
export interface IngestMetadata {
  type?: string;
  date?: string;
  platform?: string;
  audience?: string;
  tone?: string;
  primaryThemes?: string[];
  secondaryThemes?: string[];
  keyArgument?: string;
  coreTension?: string;
  repurposingVectors?: string[];
}

export interface IngestInput {
  notebookId: string;
  docId: string;
  title?: string;
  content: string;
  section_path?: string;
  metadata?: IngestMetadata;
}

export interface IngestResult {
  notebookId: string;
  docId: string;
  title: string;
  chunks: number;
  ids: string[];
}

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";
const MAX_CONTENT_CHARS = 200_000;
const MAX_CHUNKS = 100;
const MAX_CHUNK_CHARS = 1800;

function deriveTitle(docId: string): string {
  return docId.replace(/^doc-/, "").replace(/-/g, " ").toUpperCase() || "UNTITLED";
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-") || "doc";
}

export function buildHeaderPrefix(title: string, metadata?: IngestMetadata): string {
  if (!metadata) return "";
  const parts: string[] = [`Doc: ${title}`];
  if (metadata.type) parts.push(`Type: ${metadata.type}`);
  if (metadata.date) parts.push(`Date: ${metadata.date}`);
  if (metadata.platform) parts.push(`Platform: ${metadata.platform}`);
  if (metadata.audience) parts.push(`Audience: ${metadata.audience}`);
  if (metadata.tone) parts.push(`Tone: ${metadata.tone}`);
  const themes = [...(metadata.primaryThemes ?? []), ...(metadata.secondaryThemes ?? [])];
  if (themes.length > 0) parts.push(`Themes: ${themes.join(", ")}`);
  if (metadata.keyArgument) parts.push(`Argument: ${metadata.keyArgument}`);
  if (metadata.coreTension) parts.push(`Tension: ${metadata.coreTension}`);
  if (metadata.repurposingVectors && metadata.repurposingVectors.length > 0) {
    parts.push(`Repurposing: ${metadata.repurposingVectors.join(", ")}`);
  }
  return `[${parts.join(" | ")}]`;
}

export interface MarkdownChunk {
  text: string;
  sectionPath: string;
}

// Split markdown by headers, ~400 words per chunk. A header line
// starts a new chunk and becomes its sectionPath (the header text
// itself is not stored as chunk content — it is carried in
// sectionPath and in the embedded text, so it is not lost).
// A section longer than 400 words is split at that boundary, and
// any single chunk over 3,000 characters is hard-sliced, so one
// giant line cannot blow up a single embedding.
export function splitMarkdown(content: string, maxWords: number = 400): MarkdownChunk[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: MarkdownChunk[] = [];
  let currentSection = "General";
  let currentLines: string[] = [];
  let currentWords = 0;

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text) chunks.push({ text, sectionPath: currentSection });
    currentLines = [];
    currentWords = 0;
  };

  for (const line of normalized.split("\n")) {
    const header = line.match(/^#{1,6}\s+(.*)$/);
    if (header) {
      flush();
      currentSection = header[1].trim() || currentSection;
      continue;
    }
    currentLines.push(line);
    currentWords += line.split(/\s+/).filter(Boolean).length;
    if (currentWords >= maxWords) flush();
  }
  flush();

  // Hard-slice any oversized chunk (e.g. one very long line).
  const sliced: MarkdownChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.text.length <= 3000) {
      sliced.push(chunk);
    } else {
      for (let i = 0; i < chunk.text.length; i += 3000) {
        sliced.push({ text: chunk.text.slice(i, i + 3000), sectionPath: chunk.sectionPath });
      }
    }
  }
  return sliced;
}

// Backwards-compatible text-only wrapper.
export function splitIntoChunks(content: string): string[] {
  return splitMarkdown(content).map((chunk) => chunk.text);
}

export async function ingestDocument(env: Env, input: IngestInput): Promise<IngestResult> {
  const notebookId = input.notebookId?.trim();
  const docId = input.docId?.trim();
  const content = input.content ?? "";
  if (!notebookId) throw new Error("notebookId is required");
  if (!docId) throw new Error("docId is required");
  if (!content.trim()) throw new Error("content is required");
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(`content exceeds ${MAX_CONTENT_CHARS} characters`);
  }

  const title = input.title?.trim() || deriveTitle(docId);
  const docSection = input.section_path?.trim();
  const markdownChunks = splitMarkdown(content);
  if (markdownChunks.length === 0) throw new Error("content produced no chunks");
  if (markdownChunks.length > MAX_CHUNKS) {
    throw new Error(`document splits into ${markdownChunks.length} chunks, over the ${MAX_CHUNKS} limit`);
  }
  const chunkTexts = markdownChunks.map((chunk) => chunk.text);
  // A chunk's section is its markdown header; only chunks before any
  // header (section "General") fall back to the doc-level section_path.
  const sectionPaths = markdownChunks.map((chunk) =>
    chunk.sectionPath === "General" && docSection ? docSection : chunk.sectionPath,
  );

  const safeDoc = sanitizeIdPart(docId);
  const ids = chunkTexts.map((_, i) => `${safeDoc}-${String(i + 1).padStart(3, "0")}`);

  // 1. Delete any existing chunks for this document, so re-ingest replaces.
  const existing = await env.DB.prepare(
    "SELECT id FROM chunks WHERE notebook_id = ? AND doc_id = ?",
  )
    .bind(notebookId, docId)
    .all();
  const existingIds = ((existing.results ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (existingIds.length > 0) {
    if (typeof env.VECTOR_INDEX.deleteByIds === "function") {
      await env.VECTOR_INDEX.deleteByIds(existingIds);
    }
    await env.DB.prepare("DELETE FROM chunks WHERE notebook_id = ? AND doc_id = ?")
      .bind(notebookId, docId)
      .run();
    for (const id of existingIds) {
      await env.DB.prepare("DELETE FROM chunks_fts WHERE id = ?").bind(id).run();
    }
  }

  // 2. Embed all chunks in one Workers AI call (not one call per chunk).
  // The embedded text carries the Universal Header prefix (when
  // metadata is supplied) + section + chunk body, so a query matching
  // a theme, argument, or section still retrieves the chunk. The
  // stored content stays raw chunk text.
  const headerPrefix = buildHeaderPrefix(title, input.metadata);
  const texts = chunkTexts.map((text, i) =>
    headerPrefix
      ? `${headerPrefix}\n[Section: ${sectionPaths[i]}]\n${text}`
      : `${title}\n${text}\n${sectionPaths[i]}`,
  );
  const aiResponse = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] };
  const vectors = aiResponse.data;
  if (!vectors || vectors.length !== chunkTexts.length) {
    throw new Error("Embedding failed: unexpected vector count");
  }

  // 3 + 4. Upsert to Vectorize and insert into D1 concurrently — the
  // two stores are independent, so there is no reason to serialize
  // them. D1 inserts run one chunk at a time inside that branch to
  // avoid D1 batch-size uncertainty for larger documents.
  const vectorPromise = env.VECTOR_INDEX.upsert(
    ids.map((id, i) => ({
      id,
      values: vectors[i],
      metadata: { notebook_id: notebookId, doc_id: docId },
    })),
  );
  const d1Promise = (async () => {
    for (let i = 0; i < chunkTexts.length; i++) {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO chunks (id, notebook_id, doc_id, title, content, section_path) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(ids[i], notebookId, docId, title, chunkTexts[i], sectionPaths[i])
        .run();
      await env.DB.prepare("INSERT INTO chunks_fts (id, notebook_id, content) VALUES (?, ?, ?)")
        .bind(ids[i], notebookId, chunkTexts[i])
        .run();
    }
  })();
  await Promise.all([vectorPromise, d1Promise]);

  return { notebookId, docId, title, chunks: chunkTexts.length, ids };
}
