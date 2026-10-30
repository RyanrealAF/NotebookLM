// Seed corpus for the Hybrid Search Engine.
// These are the same 8 sample chunks shown in the Pages demo (index.html).
// The /api/seed endpoint embeds and inserts exactly these chunks, so the
// live backend and the demo start from the same corpus. Keep them in sync
// if either copy changes.

export interface SeedChunk {
  id: string;
  notebookId: string;
  docId: string;
  title: string;
  section_path: string;
  content: string;
}

export const INITIAL_CHUNKS: SeedChunk[] = [
  {
    id: "chunk-nlm-01",
    notebookId: "nb-indexing-framework",
    docId: "doc-nlm-framework",
    title: "NotebookLM Indexing & Analysis Framework",
    section_path: "Framework > Operating Logic",
    content:
      "This framework is a structured indexing system designed to maximize what Google NotebookLM can extract from a large corpus of original writing, sermons, essays, and research. Annotated, tagged, and contextualized documents produce systemic analysis.",
  },
  {
    id: "chunk-nlm-02",
    notebookId: "nb-indexing-framework",
    docId: "doc-nlm-framework",
    title: "Universal Document Header Template",
    section_path: "Framework > Preparation Protocol",
    content:
      "Paste metadata at top of files: TITLE, TYPE, DATE, PLATFORM, AUDIENCE, TONE, PRIMARY/SECONDARY THEMES, KEY ARGUMENT, CORE TENSION, and REPURPOSING VECTORS (Sermon, Social, Song Lyric, Long-form).",
  },
  {
    id: "chunk-nlm-03",
    notebookId: "nb-ops-manual",
    docId: "doc-nlm-ops",
    title: "Agent Notebook LM Ops Manual",
    section_path: "Ops Manual > Strategic Architect",
    content:
      "Agent Notebook LM is the Strategic Blueprint Agent. Its singular mission is to convert a high-level abstract concept or chaotic stream of consciousness into a formalized, executable protocol for other specialized AI agents (Anvil Protocol, Midi Syndicate).",
  },
  {
    id: "chunk-nlm-04",
    notebookId: "nb-judge-pack",
    docId: "doc-nlm-eval",
    title: "Notebook LM Evaluation Schema & Scoring Rubric",
    section_path: "Evaluation > Rubric",
    content:
      "Scoring rubric attributes (1-10): Clarity, Utility (DAW/MIDI application), Modularity, Emotional Intelligence (lyric-driven composition), and Technical Accuracy. Compares submissions section-by-section using standard tags.",
  },
  {
    id: "chunk-nlm-05",
    notebookId: "nb-gospel-grey",
    docId: "doc-gospel-grey",
    title: "The Gospel of Grey - Theme & Reflection",
    section_path: "The Gospel of Grey > Core Themes",
    content:
      "Explores street spirituality, grace in non-binary moral spaces, resilient faith through hardship, and authentic narrative prose.",
  },
  {
    id: "chunk-nlm-06",
    notebookId: "nb-love-loss",
    docId: "doc-love-loss",
    title: "Love, Loss, and Resilience: A Journey Through Despair",
    section_path: "Resilience > Chapter 1",
    content:
      "A deep narrative journey through grief, personal recovery, identity transformation, and building resilience out of emotional wreckage.",
  },
  {
    id: "chunk-101",
    notebookId: "nb-tech-docs",
    docId: "doc-cf-workers",
    title: "Cloudflare Workers Overview",
    section_path: "Docs > Workers > Runtime",
    content:
      "Cloudflare Workers provides a serverless execution environment that allows you to create entirely new applications or augment existing ones without configuring or maintaining infrastructure.",
  },
  {
    id: "chunk-102",
    notebookId: "nb-tech-docs",
    docId: "doc-cf-vectorize",
    title: "Vectorize DB Integration",
    section_path: "Docs > Vectorize > Querying",
    content:
      "Vectorize is Cloudflare's global vector database. It enables building full-text vector search and similarity retrieval into Workers applications using bge-large-en-v1.5 embeddings.",
  },
];
