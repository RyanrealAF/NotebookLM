// Worker entry point for the NotebookLM Hybrid Search Engine.
//
// Endpoints:
//   POST /api/search  { query, notebookId?, topK?, alpha? } -> { results }
//   POST /api/ingest  { notebookId, docId, title?, content, section_path? }
//                     -> { notebookId, docId, title, chunks, ids }
//     Single-user ingestion: splits markdown by headers at ~400 words
//     per chunk, embeds them, and upserts to Vectorize + D1.
//     Re-ingesting the same notebookId + docId replaces that document
//     (see src/ingest.ts).
//   POST /api/seed    (no body needed) -> { seeded, ids }
//     Embeds the 8 sample chunks in src/data.ts with bge-large-en-v1.5,
//     upserts their vectors into Vectorize (metadata notebook_id, so
//     scoped search can filter), and inserts them into D1 chunks +
//     chunks_fts. Run once after deploy, and again only if the seed
//     corpus changes. It is idempotent: re-seeding replaces the same ids.
//   OPTIONS             CORS preflight (the Pages site calls this Worker
//                       cross-origin, so CORS headers are required;
//                       the Deployment Guide's sample omitted them).
//
// CORS is wide open (*) because this is a demo backend. Before using
// this for anything sensitive, restrict Access-Control-Allow-Origin to
// https://notebooklm-8by.pages.dev.

import { CloudflareHybridRetriever, Env, HybridSearchQuery } from "./retriever";
import { INITIAL_CHUNKS } from "./data";
import { ingestDocument, IngestInput } from "./ingest";

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders() });
}

async function handleSeed(env: Env): Promise<Response> {
  // Embed all chunks in one Workers AI call. The text embedded is
  // title + content + section path, so a query matching a title or
  // section still retrieves the chunk.
  const texts = INITIAL_CHUNKS.map((c) => `${c.title}\n${c.content}\n${c.section_path}`);
  const aiResponse = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] };
  const vectors = aiResponse.data;

  if (!vectors || vectors.length !== INITIAL_CHUNKS.length) {
    return json({ error: "Embedding failed: unexpected vector count" }, 500);
  }

  await env.VECTOR_INDEX.upsert(
    INITIAL_CHUNKS.map((chunk, i) => ({
      id: chunk.id,
      values: vectors[i],
      metadata: { notebook_id: chunk.notebookId, doc_id: chunk.docId },
    })),
  );

  const statements = INITIAL_CHUNKS.flatMap((chunk) => [
    env.DB.prepare(
      "INSERT OR REPLACE INTO chunks (id, notebook_id, doc_id, title, content, section_path) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(chunk.id, chunk.notebookId, chunk.docId, chunk.title, chunk.content, chunk.section_path),
    env.DB.prepare("DELETE FROM chunks_fts WHERE id = ?").bind(chunk.id),
    env.DB.prepare("INSERT INTO chunks_fts (id, notebook_id, content) VALUES (?, ?, ?)").bind(
      chunk.id,
      chunk.notebookId,
      chunk.content,
    ),
  ]);
  await env.DB.batch(statements);

  return json({ seeded: INITIAL_CHUNKS.length, ids: INITIAL_CHUNKS.map((c) => c.id) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Endpoint: POST /api/search
    if (url.pathname === "/api/search" && request.method === "POST") {
      let params: HybridSearchQuery;
      try {
        params = (await request.json()) as HybridSearchQuery;
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
      if (!params.query || typeof params.query !== "string") {
        return json({ error: "query is required" }, 400);
      }
      const retriever = new CloudflareHybridRetriever(env);
      const results = await retriever.search(params);
      return json({ results });
    }

    // Optional write protection: if INGEST_TOKEN is set as a Worker
    // secret, mutating endpoints require it. Search stays open.
    const requiresToken =
      (url.pathname === "/api/seed" || url.pathname === "/api/ingest") &&
      request.method === "POST";
    if (requiresToken && env.INGEST_TOKEN && request.headers.get("x-ingest-token") !== env.INGEST_TOKEN) {
      return json({ error: "Missing or incorrect X-Ingest-Token" }, 401);
    }

    // Endpoint: POST /api/ingest
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      let input: IngestInput;
      try {
        input = (await request.json()) as IngestInput;
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
      try {
        const result = await ingestDocument(env, input);
        return json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ingest failed";
        const isValidation =
          /required|exceeds|over the|no chunks/.test(message);
        return json({ error: message }, isValidation ? 400 : 500);
      }
    }

    // Endpoint: POST /api/seed
    if (url.pathname === "/api/seed" && request.method === "POST") {
      return handleSeed(env);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};
