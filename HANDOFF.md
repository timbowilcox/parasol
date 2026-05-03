# Handoff: Sprint 1, Day 3 — Corpus pipeline + NDA dataset

Date: 2026-05-04
Session type: Sprint 1 Day 3

## What was completed

Day 3 scope per `docs/sprint-1-plan.md`: corpus ingestion pipeline (scraper → normaliser → chunker → embedder → tagger → repository → orchestrator → CLI). Also: 20-NDA golden dataset sourced from public web (since Tim has none in the personal network).

### Database typing (extended)

- `packages/core/src/db.ts` — added Row/Insert/Update for `corpus_sources`, `corpus_ingestion_runs`, `corpus_documents`, `corpus_chunks` and wired into the `Database` interface.

### Corpus pipeline (`packages/corpus/src/`)

- `types.ts` — canonical types: `RawDocument` (scraper output), `NormalisedDocument` + `Section` (post-normalisation tree), `Chunk` (chunker output), `AreaOfLaw`, `IngestedDocumentResult`, `IngestionRunResult`.
- `normaliser.ts` — HTML/plaintext → clean structured text. Cheerio-based DOM walk strips nav/script/style/aside/header/footer, builds a hierarchy of `Section` nodes from heading levels (h1–h6) for statutes, paragraph-list for judgments. `splitHeadingLabel('Section 12 — Confidentiality')` → `{ label: 'Section 12', heading: 'Confidentiality' }`. Pure functions, no IO.
- `chunker.ts` — section-aware chunker. Walks the section tree depth-first, packs text into ~2000-char (≈500-token) chunks at section boundaries, falling back to paragraph → sentence → whitespace split for oversize sections. Each chunk's `textWithContext` field prefixes the hierarchy: `"Companies Act 2015 → Part III → Section 12 — Confidentiality: <text>"`. This is what gets embedded.
- `embedder.ts` — Voyage-3 wrapper. Singleton client lazy-initialised from `VOYAGE_API_KEY`. `embedTexts()` batches in groups of 128 (Voyage hard cap). `embedChunks(chunks)` mutates each chunk's `embedding` field. `overrideEmbedderClient()` test hook.
- `tagger.ts` — Haiku 4.5 tagger that returns `{clauseTypes, areaOfLaw}` for a chunk. Uses controlled vocabulary in `@parasol/core` (40 clause types + 12 areas of law). Output validated via Zod against the vocabulary (parsed-but-invalid responses become empty tags rather than throwing). `InMemoryTagCache` keyed by SHA256(text); persistent cache (Redis/Postgres) deferred to Sprint 4.
- `repository.ts` — `CorpusRepository`: `listSources`, `getSourceBySlug`, `updateSourceStatus`, `createRun`, `completeRun`, `findLatestDocument`, `createDocument`, `markSuperseded`, `insertChunks` (auto-batched at 100 rows), `deleteChunksForDocument`. Lives in `@parasol/corpus` (not `@parasol/core`) because it's domain-specific.
- `scrapers/types.ts` — `Scraper` interface (`slug`, `listAvailable`, `fetchDocument`) + `politeFetch()` helper (per-host minimum interval, default 2s, configurable for tests; identifies as "Parasol Corpus Ingestion" by default).
- `scrapers/kenyalaw.ts` — `KenyaLawScraper` for kenyalaw.org. Sprint 1 fixture set: Constitution 2010, Data Protection Act 2019, Companies Act 2015, KICA 1998. URL pattern: `https://kenyalaw.org/akn/ke/act/<year>/<num>/eng`. Full enumeration of all Acts + judgments deferred to Sprint 4 (DEF-017 alongside scheduler).
- `ingest.ts` — orchestrator: source → run → fetch → normalise → chunk → tag → embed → persist. Per-document try/catch so a single failure doesn't kill the whole run. Updates `corpus_sources.status` to `running → healthy/warning/error`. Idempotency: `skipUnchanged: true` byte-compares against the latest existing row's `full_text`. Re-ingestion supersedes (sets `superseded_at` + `superseded_by_id` on the prior version).
- `cli/ingest-kenya.ts` — `pnpm --filter @parasol/corpus run ingest:kenya`. Reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env. Flags: `--limit=<n>`, `--skip-embedding`, `--skip-tagging`, `--skip-unchanged`. Streams per-document progress to stdout.

### Tests added (49 new)

| Suite | Tests |
|-------|-------|
| `normaliser.test.ts` | 11 — heading hierarchy, nav/script stripping, judgment paragraph split, plain-text labels, serialisation |
| `chunker.test.ts` | 9 — paragraph/sentence/word splitting, hierarchy preservation, chunkIndex order, oversize section split, empty-sections fallback |
| `tagger.test.ts` | 14 — content hash determinism, JSON parsing (fenced/prose-wrapped/invalid), vocabulary validation, in-memory cache hit/miss/key-by-text, batch tagging |
| `embedder.test.ts` | 9 — empty-input short-circuit, single-batch, multi-batch ordering, SDK error → EmbeddingError, length-mismatch → EmbeddingError, model env precedence, embedChunks mutates in place, missing key error |
| `scrapers/kenyalaw.test.ts` | 6 — fixture listing, limit, fetch happy path, 404 → null, 5xx → throw, fallback title extraction |

Cumulative repo test count: **135 passing across 6 packages** (+49 today).

### NDA golden dataset (`packages/eval/data/golden/nda/`)

A background agent sourced 20 publicly-available NDAs (delegated because Tim has none in his personal network). All in `.gitignore` so files stay local.

**Format mix**: 14 PDF + 6 DOCX (exceeds the ≥5/5 minimum, exercises both extraction code paths).

**Subtype mix**: 7 real party-to-party signed (mutual), 4 real one-way, 4 mutual templates, 5 one-way templates.

**Jurisdiction mix**: 14 US (mostly SEC EDGAR M&A and tender-offer exhibits — Calpine, NCR, Sybase, SuccessFactors, Cogent, Vocus, etc.), 4 UK (gov.uk publishing service, Dstl/MoD secondee NDA, National Archives), 2 Kenya (Britam supplier NDA — exactly the kind a customer would receive — and UN-Habitat Nairobi).

**Sources**: SEC EDGAR full-text search API, Common Paper (CC-BY-4.0), gov.uk, UK National Archives, Britam Kenya, UN-Habitat. Some EDGAR HTML files were rendered to PDF via headless Chrome; some converted to DOCX via paragraph extraction. Manifest `manifest.yaml` lists filename, source_url, source_name, jurisdiction, subtype, parties, notes, size_bytes, sha256 per file.

**Quality concerns** (to revisit on Day 6 when the eval harness runs):
- `nda-009.pdf` is a Common Paper 2-page cover that links to online standard terms — most clauses live at the URL, not in the file. Useful as an edge case.
- `nda-017.docx` (UN-Habitat) was extracted from an old OLE `.doc` via regex; text is clean but paragraph boundaries are heuristic.
- Only 2/20 are Kenya-jurisdictional. The pipeline still exercises the playbook structurally; Kenya-specific outputs (jurisdictional violations, DPA references, KSh provisions) will trigger more strongly when Sprint 7+ broadens the dataset.

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18 successful, 18 total (6 packages × 3 tasks)
→ Zero TS errors, zero lint warnings
→ 135 tests passing across all 6 packages
```

## What is NOT done

- Live ingestion against real kenyalaw.org — the scraper interface and Kenya scraper are wired, but the seed run (`pnpm corpus:ingest:kenya`) hasn't been executed yet. Day 4 will run it for the fixture set as part of testing the retrieval function. Unblocked: the CLI is ready; just needs `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and a Voyage API call budget.
- Hybrid retrieval (Day 4): `retrieveAuthority(query, options)` with BM25 + pgvector + RRF + Voyage rerank-2.
- Full enumeration of kenyalaw.org sources (judgments, gazette, ODPC, KRA tribunal, CBK, CMA). Sprint 1 fixture: 4 statutes only. Multi-source enumeration deferred to Sprint 4 alongside the scheduler.
- Persistent tag cache. In-memory only for now; Sprint 4 wires Redis or a Postgres table.
- Eval harness. Lands Day 6.
- Lawyer review of `packages/playbooks/kenya/nda.yaml` — needed by Day 5 (DEF-028).
- Resend MX record for `ask.parasol.co.ke` — needed by Day 5 (Tim action, DEF-001).

## Known issues / technical notes

- **Circular workspace dependency removed**: `@parasol/ai` had `@parasol/corpus` and `@parasol/playbooks` as deps from the original scaffold but didn't import either. Removing them broke a `turbo` cycle warning that surfaced when corpus added `@parasol/ai` as its tagger dep. AI now declares only `@parasol/core` and the SDKs. The orchestrator (Day 7+) will accept retrieval results as part of `OrchestratorContext.authorityChunks` rather than importing from corpus directly, preserving the acyclic structure.
- **`domhandler` declared explicitly**: cheerio doesn't re-export DOM types. Added `domhandler` (already a transitive dep) to `packages/corpus/package.json` so `import type { AnyNode } from 'domhandler'` works.
- **NBSP in regex**: had to escape an embedded U+00A0 in the cleanText regex as ` `. ESLint's `no-irregular-whitespace` flagged the literal byte.
- **Tagger LLM call goes through `@parasol/ai`**, so it's behind the same singleton + caching infrastructure as future stage prompts. Means the tagger picks up any future client-level retry / observability we add.

## Database state

Unchanged from Day 1. All 4 migrations remain applied. Day 4's retrieval work doesn't need new migrations.

## Exact next step (Day 4)

⚠️ **Day 5 deadlines approaching**: lawyer engagement for `kenya/nda.yaml` review (DEF-028) and Resend MX on `ask.parasol.co.ke` (DEF-001).

Day 4 goal: hybrid retrieval. The `retrieveAuthority` function must pass the DPA s.49 test before Day 5.

1. **`packages/corpus/src/retrieval.ts`** — `retrieveAuthority(query, options)` with:
   - BM25 via Postgres FTS (`ts_rank_cd`)
   - Dense retrieval via pgvector cosine similarity (HNSW index already in place from migration 0002)
   - Reciprocal rank fusion to merge BM25 and dense rankings
   - Voyage rerank-2 on top-30 RRF results
   - Clause-type + jurisdiction filters at retrieval time
2. **`packages/corpus/src/retrieval.test.ts`** — integration test asserting "data protection cross-border transfer" returns DPA 2019 s.49 in top 3.
3. **`pnpm corpus:ingest:kenya` smoke test** — actually run the seed ingestion against dev Supabase. Should fetch the 4 fixture statutes, normalise, chunk, embed (this will use Voyage budget), tag (Haiku), and write to corpus_documents + corpus_chunks. Verify chunk count in Supabase dashboard.

Day 4 has no Tim action items. Day 5 is the next one (lawyer + Resend MX).
