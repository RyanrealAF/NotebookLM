// Cloudflare Global Multi-Notebook Retriever Implementation.
//
// Hybrid search = vector search (Vectorize, bge-large-en-v1.5 embeddings)
// fused with lexical search (D1 FTS5) by Reciprocal Rank Fusion, k = 60,
// weighted by alpha (0.7 = 70% vector, 30% lexical by default).
//
// Bindings are intentionally typed as `any` here so this file typechecks
// without @cloudflare/workers-types installed. The binding NAMES are what
// matter, and they must match wrangler.toml exactly:
//   AI           -> Workers AI
//   DB           -> D1 database notebook-db
//   VECTOR_INDEX -> Vectorize index notebook-vector-index (NOT "VECTORIZE")

export interface Env {
  AI: any;
  DB: any;
  VECTOR_INDEX: any;
  // Optional Worker secret (wrangler secret put INGEST_TOKEN). When set,
  // /api/ingest and /api/seed require header X-Ingest-Token to match.
  // When unset, those endpoints are open, as they are for this demo.
  INGEST_TOKEN?: string;
}

export interface HybridSearchQuery {
  query: string;
  notebookId?: string; // Optional: Pass specific notebook ID or omit for global search
  topK?: number;
  alpha?: number;
}

export interface HybridSearchResult {
  id: string;
  notebook_id: string;
  doc_id: string;
  title: string | null;
  content: string;
  section_path: string | null;
  rrfScore: number;
  vectorRank: number | null;
  ftsRank: number | null;
}

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";
const RRF_K = 60;

export class CloudflareHybridRetriever {
  constructor(private env: Env) {}

  async search(params: HybridSearchQuery): Promise<HybridSearchResult[]> {
    const topK = params.topK ?? 5;
    const alpha = params.alpha ?? 0.7;
    const scoped = params.notebookId && params.notebookId !== "ALL";

    // Lexical (FTS5) search. The guide's scoped query filters by
    // notebook_id in SQL; if that form ever fails on an FTS5 table,
    // fall back to the unscoped query and filter in JS, so a scope
    // quirk can never take down the whole search.
    let ftsRows: Array<{ id: string; notebook_id: string; content: string; rank: number }> = [];
    try {
      const ftsQuery = scoped
        ? this.env.DB.prepare(
            `SELECT id, notebook_id, content, rank FROM chunks_fts
             WHERE chunks_fts MATCH ? AND notebook_id = ?
             ORDER BY rank LIMIT ?`,
          ).bind(params.query, params.notebookId, topK * 2)
        : this.env.DB.prepare(
            `SELECT id, notebook_id, content, rank FROM chunks_fts
             WHERE chunks_fts MATCH ?
             ORDER BY rank LIMIT ?`,
          ).bind(params.query, topK * 2);
      const ftsResults = await ftsQuery.all();
      ftsRows = (ftsResults.results ?? []) as typeof ftsRows;
    } catch {
      const fallback = await this.env.DB.prepare(
        `SELECT id, notebook_id, content, rank FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY rank LIMIT ?`,
      )
        .bind(params.query, topK * 2)
        .all();
      const allRows = (fallback.results ?? []) as typeof ftsRows;
      ftsRows = scoped ? allRows.filter((row) => row.notebook_id === params.notebookId) : allRows;
    }

    // Vector search. The embedding model here MUST be the same model used
    // to embed chunks at seed time, or the vectors are not comparable.
    const [aiResponse] = await Promise.all([
      this.env.AI.run(EMBEDDING_MODEL, { text: [params.query] }) as Promise<{ data: number[][] }>,
    ]);
    const queryVector = aiResponse.data[0];

    // Metadata filtering by notebook_id requires a metadata index on
    // notebook_id, created BEFORE any vectors were inserted (see
    // wrangler.toml header). Without it, scoped vector search cannot filter.
    const filter = scoped ? { notebook_id: params.notebookId } : undefined;

    const vectorResults = await this.env.VECTOR_INDEX.query(queryVector, {
      topK: topK * 2,
      filter,
      returnMetadata: "all",
    });

    // Reciprocal Rank Fusion, keeping each side's rank for display.
    const rrfScores = new Map<string, number>();
    const vectorRanks = new Map<string, number>();
    const ftsRanks = new Map<string, number>();

    (vectorResults.matches ?? []).forEach((match: { id: string }, index: number) => {
      const score = alpha * (1 / (RRF_K + index + 1));
      rrfScores.set(match.id, (rrfScores.get(match.id) || 0) + score);
      vectorRanks.set(match.id, index + 1);
    });

    ftsRows.forEach((row, index) => {
      const score = (1 - alpha) * (1 / (RRF_K + index + 1));
      rrfScores.set(row.id, (rrfScores.get(row.id) || 0) + score);
      ftsRanks.set(row.id, index + 1);
    });

    const sortedChunkIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);

    if (sortedChunkIds.length === 0) return [];

    // Hydrate full chunks from D1, in RRF order.
    const placeholders = sortedChunkIds.map(() => "?").join(",");
    const hydrationQuery = `SELECT id, notebook_id, doc_id, title, content, section_path FROM chunks WHERE id IN (${placeholders})`;

    const { results: finalChunks } = await this.env.DB.prepare(hydrationQuery)
      .bind(...sortedChunkIds)
      .all();

    const chunkMap = new Map(
      (finalChunks as Array<Omit<HybridSearchResult, "rrfScore">>).map((c) => [c.id, c]),
    );
    return sortedChunkIds
      .map((id) => {
        const chunk = chunkMap.get(id);
        if (!chunk) return null;
        return {
          ...chunk,
          rrfScore: rrfScores.get(id) ?? 0,
          vectorRank: vectorRanks.get(id) ?? null,
          ftsRank: ftsRanks.get(id) ?? null,
        };
      })
      .filter((c): c is HybridSearchResult => c !== null);
  }
}
