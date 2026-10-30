# Deploying the Cloudflare Hybrid Search Engine

Follow these steps to deploy the Hybrid Search Engine and Vector/FTS Indexer on **Cloudflare Workers**, **Vectorize**, and **D1 Database**.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) installed globally or locally:
  ```bash
  npm install -g wrangler
  ```
- A Cloudflare account logged in via CLI:
  ```bash
  wrangler login
  ```

---

## 2. Infrastructure Setup (D1 & Vectorize)

### A. Create the D1 Database
Create a Cloudflare D1 SQL database to store chunk metadata and FTS5 indices:
```bash
wrangler d1 create notebook-db
```
*Note the returned `database_id` for your `wrangler.toml`.*

### B. Initialize Database Schema
Create a file named `schema.sql` with the following contents:

```sql
-- Table for full chunk hydration
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  content TEXT NOT NULL,
  section_path TEXT
);

-- Full-Text Search 5 (FTS5) table for lexical matching
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED,
  notebook_id UNINDEXED,
  content
);
```

Apply the schema to your D1 database:
```bash
wrangler d1 execute notebook-db --file=./schema.sql
```

### C. Create the Vectorize Index
Create a Vectorize vector database configured for `bge-large-en-v1.5` embeddings (1024 dimensions, cosine distance metric):
```bash
wrangler vectorize create notebook-vector-index --dimensions=1024 --metric=cosine
```

---

## 3. Configuration (`wrangler.toml`)

Create or update your `wrangler.toml` file in the root of your project:

```toml
name = "notebook-hybrid-search"
main = "src/index.ts"
compatibility_date = "2026-10-30"

# Workers AI binding for BGE embeddings
[ai]
binding = "AI"

# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "notebook-db"
database_id = "YOUR_D1_DATABASE_ID_HERE"

# Vectorize Index binding
[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "notebook-vector-index"
```

---

## 4. Worker Code (`src/index.ts`)

Create your Worker endpoint handling indexing and hybrid query requests:

```typescript
import { CloudflareHybridRetriever, HybridSearchQuery } from './retriever';

export interface Env {
  AI: any;
  DB: D1Database;
  VECTOR_INDEX: VectorizeIndex;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Endpoint: POST /api/search
    if (url.pathname === '/api/search' && request.method === 'POST') {
      const params: HybridSearchQuery = await request.json();
      const retriever = new CloudflareHybridRetriever(env);
      const results = await retriever.search(params);
      
      return Response.json({ results });
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

---

## 5. Deployment

Deploy the application directly to Cloudflare's global edge network:

```bash
wrangler deploy
```

---

## 6. Testing the Deployed Endpoint

Send a POST request to your deployed Worker endpoint:

```bash
curl -X POST https://notebook-hybrid-search.<your-subdomain>.workers.dev/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "NotebookLM evaluation rubric scoring",
    "notebookId": "ALL",
    "topK": 5,
    "alpha": 0.7
  }'
```