# @parasol/corpus

Corpus ingestion, chunking, embedding, retrieval, and source management. The Kenyan-law knowledge layer Parasol's redlines are grounded in.

Architecture detail: `docs/corpus-pipeline.md`. Admin UI for managing this is `docs/admin-surfaces.md` Corpus Health surface.

## Structure

```
src/
├── index.ts                # Public exports
├── ingest/                 # Source-specific scrapers + normalisers
│   ├── kenya-law.ts        # KenyaLaw.org caselaw scraper
│   ├── parliament.ts       # Acts and gazettes
│   ├── erc.ts              # Energy Regulatory Commission
│   └── ...
├── chunk/                  # Hierarchical chunking with parent doc preservation
├── embed/                  # Voyage-3 embedding pipeline
├── retrieve/               # Hybrid search: BM25 + dense + Voyage rerank
├── tag/                    # LLM-assisted chunk tagging at ingest time
├── schedule/               # Source schedule management (read by admin UI)
└── db/                     # Supabase client and typed queries
```

## Source taxonomy

Every chunk traces back to a `corpus_source` row. Sources have:
- `id`, `name`, `kind` (caselaw / statute / regulation / commentary / gazette)
- `jurisdiction` (kenya / east-africa / commonwealth-comparable)
- `authority_weight` (0–10; affects retrieval ranking)
- `schedule` (cron expression; null = manual only)
- `enabled` (boolean)
- `last_run_at`, `last_run_status`, `last_run_summary`

The admin Corpus Health surface reads from this table joined with `corpus_runs` (run history).

## Retrieval

Hybrid by default:
1. BM25 over chunk text (`pg_trgm` gin index)
2. Cosine similarity over Voyage-3 embeddings (pgvector)
3. Reciprocal rank fusion of (1) and (2)
4. Voyage rerank-2 over top 50 fused
5. Return top K with citation metadata

Clause-type-aware filtering applied pre-fusion: an NDA confidentiality clause retrieves from caselaw and statutes tagged with confidentiality / trade secrets / data protection, not employment law.

## Ingestion conventions

- **Idempotent.** Re-running a source against unchanged content is a no-op (content hash check).
- **Parent doc preserved.** Chunks store a pointer to the full source doc. Citations resolve back to the original.
- **Versioned.** Source documents that change over time (statutes amended, cases reported on) keep a version chain.
- **Schedule discipline.** Daily for caselaw RSS, weekly for statutes, manual for editorial pieces. Configurable from admin UI.

## What this package does NOT do

- LLM reasoning over corpus content — that's `@parasol/ai`
- Playbook authoring — that's `@parasol/playbooks`
- Workspace-scoped client documents — those live in workspace-specific tables and don't enter the corpus
