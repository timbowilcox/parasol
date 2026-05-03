# Corpus Pipeline

The corpus is the moat. Most builders underinvest here while obsessing over the model. We do the opposite.

## Purpose

A versioned, structured, retrievable knowledge base of Kenyan and EAC legal authority that grounds every Parasol output in verifiable source material. Without this layer, citation validity is impossible and trust collapses.

## Sources (v1, Kenya only)

| Source | Volume | Update cadence | Free? |
|--------|--------|----------------|-------|
| Constitution of Kenya 2010 | 1 doc | Rare | Yes (kenyalaw.org) |
| Acts of Parliament | ~600 active acts | Weekly amendments | Yes |
| Subsidiary Legislation | ~5,000 instruments | Monthly | Yes |
| Court of Appeal judgments | ~10,000+ historical | Daily | Yes |
| High Court judgments | ~200,000+ historical | Daily | Yes |
| Supreme Court judgments | ~2,000+ | Weekly | Yes |
| Tribunals (Tax, Communications, etc.) | ~5,000+ | Monthly | Mostly yes |
| ODPC determinations | ~100+ growing | As issued | Yes |
| KRA tax tribunal decisions | ~3,000+ | Monthly | Yes |
| CBK prudential guidelines | ~50 | Quarterly | Yes |
| CMA notices | ~200 | Monthly | Yes |
| Kenya Gazette weekly | Weekly | Weekly | Yes |

v2 adds: ULII (Uganda), TanzLII (Tanzania), RwandaLII (Rwanda).

## Pipeline stages

Sources → polite scraper → normaliser (clean text, structure preservation) → section-aware chunker → embedder (Voyage-3) → tagger (clause-type, area of law, dates, jurisdiction, status) → Postgres tables (`corpus_documents`, `corpus_chunks` with pgvector, `corpus_chunks_fts` for BM25).

Retrieval combines BM25 keyword + dense vector retrieval, merged via reciprocal rank fusion, reranked with Voyage rerank-2, with clause-type-aware filtering at retrieval time.

## Storage schema

```sql
create table corpus_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,           -- 'statute' | 'case' | 'regulation' | etc.
  jurisdiction text not null,          -- 'kenya' | 'uganda' | etc.
  canonical_id text not null,
  title text not null,
  full_text text not null,
  source_url text not null,
  retrieved_at timestamptz not null,
  effective_date date,
  superseded_at timestamptz,
  superseded_by_id uuid references corpus_documents(id),
  metadata jsonb,
  created_at timestamptz default now(),
  unique (source_type, jurisdiction, canonical_id, retrieved_at)
);

create table corpus_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references corpus_documents(id) on delete cascade,
  parent_chunk_id uuid references corpus_chunks(id),
  chunk_index int not null,
  hierarchy text[],
  text text not null,
  text_with_context text not null,
  clause_types text[],
  area_of_law text[],
  embedding vector(1024),
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  created_at timestamptz default now()
);

create index corpus_chunks_embedding_hnsw on corpus_chunks
  using hnsw (embedding vector_cosine_ops);
create index corpus_chunks_fts on corpus_chunks using gin (fts);
create index corpus_chunks_clause_types on corpus_chunks using gin (clause_types);
```

## Ingestion

### Scrapers

Located in `packages/corpus/src/scrapers/`. One scraper per source.

Conventions:
- Polite rate-limiting: max 1 request per 2 seconds against any single host
- User-Agent identifies as Parasol with contact email
- Respect robots.txt
- Idempotent: re-running a scraper is safe and skips already-fetched items
- Versioned: every fetch creates a new row with `retrieved_at`; old versions retained

### Normalisation

Raw HTML or PDF → clean structured text. For HTML: remove navigation, ads, decorative markup. For PDF: extract text via pdfplumber, fall back to pymupdf for layout-heavy documents, fall back to Sonnet vision for scans.

Preserve hierarchical structure, citation markers within text, defined terms (capitalised terms, italicised definitions), footnotes (linked back to body text).

Discard page headers/footers, page numbers, decorative whitespace, repeated boilerplate.

### Section-aware chunking

Chunk size: ~500 tokens, with overlap on subsection boundaries. Each chunk preserves its hierarchy in `hierarchy` array. Each chunk's `text_with_context` field includes the hierarchy as a prefix for embedding ("Companies Act 2015 → Part III → Section 12 → Subsection 3: [actual text]"). This dramatically improves retrieval recall for hierarchically-organised statutes.

For judgments: chunk by paragraph, with case citation as metadata. A judgment's first paragraph (case name, parties, judges) becomes the parent chunk; subsequent paragraphs are children with `parent_chunk_id` reference.

### Embeddings

Voyage-3, 1024 dimensions. Embed `text_with_context`, not raw text — the hierarchical context dramatically improves retrieval relevance.

Batch embedding in groups of 128. Re-embed when prompt-engineering or chunking changes; re-embed quarterly per DEF-023 to capture model improvements.

### Tagging

LLM-assisted tagging at ingest time. For each chunk, Haiku 4.5 returns:
- `clause_types`: from a controlled vocabulary of ~40 clause types (indemnification, limitation_of_liability, confidentiality_term, governing_law, etc.)
- `area_of_law`: from a controlled vocabulary (commercial, employment, data_protection, tax, regulatory, etc.)
- `entities_referenced`: parties, statutes, cases, regulators

Tagging is cached by content hash; if the underlying chunk text doesn't change, tags don't regenerate.

## Retrieval

Public API in `packages/corpus/src/retrieval.ts`:

```ts
async function retrieveAuthority(
  query: string,
  options: {
    jurisdictions: Jurisdiction[];
    clauseTypes?: ClauseType[];
    documentTypes?: DocumentType[];
    maxAge?: number;
    topK?: number;
    rerank?: boolean;
  }
): Promise<AuthorityResult[]>
```

Stages:

1. **Query expansion** (Haiku, optional): expand the query to include synonyms and related terms
2. **BM25 retrieval**: top 50 chunks by keyword match
3. **Dense retrieval**: top 50 chunks by cosine similarity on Voyage-3 embedding
4. **Filter**: apply clause type, document type, jurisdiction filters
5. **Reciprocal Rank Fusion**: merge BM25 and dense rankings into single score
6. **Voyage rerank**: rerank top 30 from RRF using Voyage rerank-2
7. **Return**: top K with full chunk text, hierarchy, document metadata, score, source URL

Rerank is critical for legal queries because BM25 over-favours lexical matches and dense retrieval over-favours semantic matches. The reranker mediates.

## Update strategy

| Source | Strategy |
|--------|----------|
| Constitution | Manual when amended |
| Acts of Parliament | Weekly Gazette scrape detects amendments; automated re-ingest |
| Subsidiary legislation | Monthly bulk re-scrape with diff |
| Judgments | Daily incremental scrape |
| ODPC, KRA, CBK, CMA | Per-source RSS or polling |
| Kenya Gazette | Weekly |

Versioning ensures customers reviewing contracts on April 15 see the law as it was on April 15, not as it is today. The `effective_date` and `superseded_at` columns are queried during retrieval.

### Operator control

Schedules, manual runs, and pending-diff review are operated through the corpus management admin surface at `/admin/corpus`. Documented in [`admin-surfaces.md`](./admin-surfaces.md). For Sprint 1 the surface is read-only with manual run triggers; full schedule editing lands by Sprint 4 (DEF-017, DEF-018) once incremental scheduling itself is wired into Vercel Cron.

## Quality assurance

- **Coverage check**: weekly automated test (DEF-021) that queries known authorities and verifies they're retrievable.
- **Diff inspection**: when a statute is re-ingested, the diff is reviewed before promoting to production. This catches OCR errors and structural changes. Pending-diff review UI per DEF-019.
- **Eval suite**: the eval harness includes ground-truth citations; corpus changes that drop these citations from retrieval fail CI.

## What we explicitly do not do

- Aggregate multiple sources into a single "Kenyan law" knowledge graph. Each source remains structurally distinct.
- Generate summaries to substitute for source text. Source text is what gets retrieved.
- Train embeddings on Kenyan legal text. Voyage-3 is good enough; fine-tuning is a v3 conversation if at all.
- Cache retrieval results aggressively. Stale cached results are worse than slow fresh ones.
- Crowdsource corpus content. Customer-uploaded statutes can't be trusted.
