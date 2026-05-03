# Handoff: Sprint 1, Day 4 — Hybrid retrieval + smoke test

Date: 2026-05-04
Session type: Sprint 1 Day 4

## What was completed

Day 4 scope per `docs/sprint-1-plan.md`: hybrid retrieval (BM25 + dense vector + RRF + Voyage rerank-2). Plus the live ingest smoke test against dev Supabase, which surfaced two issues — one I fixed (AKN root selector) and one Tim needs to fix (Voyage rate-limit, escalated DEF-005).

### New migrations

- **0005_corpus_retrieval.sql** — two SQL functions:
  - `match_corpus_chunks(query_embedding vector, match_count, jurisdiction_filter, source_type_filter, clause_types_filter)` — top-N pgvector cosine search with eager join to `corpus_documents`. Filters out superseded documents and rows with null embeddings.
  - `bm25_corpus_chunks(query_text, match_count, jurisdiction_filter, source_type_filter, clause_types_filter)` — top-N BM25 search using `websearch_to_tsquery` (forgiving of natural-language input). Returns `ts_rank_cd` scores so the JS layer can do RRF properly.
  - Both functions granted to `authenticated` so retrieval works under user session (no service-role usage in retrieval).
- **0006_corpus_grants.sql** — explicit `GRANT ALL ... TO anon, authenticated, service_role` on every Sprint 1 public table. Surfaced as the first thing the smoke test hit: `permission denied for table corpus_sources`. The default `ALTER DEFAULT PRIVILEGES` only auto-grants to tables created by the `postgres` superuser; the migrator role used by `supabase db push --db-url` doesn't pick that up. Migration also sets up `ALTER DEFAULT PRIVILEGES` going forward so future tables don't need this fix.

### `packages/core/src/db.ts` extended

- Added `Functions` to the `Database` type with typed Args/Returns for the two RPCs.
- New exported types: `CorpusChunkSearchResult`, `CorpusChunkBm25Result`.

### `packages/corpus/src/retrieval.ts` (new)

- `retrieveAuthority(query, options, ctx)` — public API. Pipeline:
  1. Embed the query in `inputType: 'query'` mode (matters for Voyage scoring)
  2. BM25 + vector retrieval in parallel (BM25 doesn't depend on the embedding)
  3. Reciprocal Rank Fusion merge (default `k=60` per the original RRF paper)
  4. Optional Voyage rerank-2 on the top-30 RRF results (default on; bypass with `skipRerank: true`)
  5. Return top K with `score`, `matchedVia: ['bm25' | 'dense']`, full chunk text + hierarchy + document metadata
- `reciprocalRankFusion(bm25, vector, k)` — pure function, separately tested. Score = sum of `1 / (k + rank)` across rankings; items present in both rank higher.
- `overrideVoyageClient()` test hook.
- Sprint 1 limitation: single jurisdiction per call (RPC takes a `text` not `text[]`). Multi-jurisdiction queries take the first jurisdiction; documented for v2.

### `packages/corpus/src/normaliser.ts` — AKN selector fix

The smoke test revealed that on Kenya Law's AKN HTML rendering, `.akn-content` is a per-paragraph span (2,119 of them in the Constitution alone), not the document root. The normaliser was picking the first one and producing a single 996-char chunk for the entire Constitution. Fixed selector priority:

```
.akn-act → .akn-akomaNtoso → main → #content → .content → body
```

After fix: Constitution produces **158 chunks** (verified via live ingest with `--skip-embedding --skip-tagging`).

### `packages/corpus/src/scrapers/kenyalaw.ts` — domain fix

Smoke test 404'd on every URL because Kenya Law moved most legal content to `https://new.kenyalaw.org` in their 2024 redesign. The legacy `kenyalaw.org` is mostly informational pages now. Updated `DEFAULT_BASE` accordingly. Also added `redirect: 'follow'` to `politeFetch` because AKN URLs use point-in-time language qualifiers (e.g. `/eng@2022-12-31`) and the bare `/eng` 302s to the latest dated revision.

## Tests added (14 new)

| Suite | Tests |
|-------|-------|
| `retrieval.test.ts` | 14 — RRF (empty inputs, single-source ranking, dual-source boost, dense-only marker, custom k, sort order, field preservation), retrieveAuthority orchestration (end-to-end, topK trim, filter pass-through, skipRerank, no-jurisdiction error, RPC error, reranker-returns-null fallback) |

Cumulative repo test count: **149 passing** (+14 today across 6 packages).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18 successful, 18 total
→ Zero TS errors, zero lint warnings, 149 tests passing
```

Live smoke test results:
```
pnpm --filter @parasol/corpus run ingest:kenya -- --limit=1 --skip-embedding --skip-tagging
→ 1 added, 0 updated, 0 errors
→ Constitution of Kenya 2010 → 158 chunks
```

## What is NOT done

- **Live retrieval acceptance test (DPA s.49 in top 3)** — blocked by DEF-005 (Voyage rate limit). The `retrieveAuthority` code is complete and tested, but without embeddings populated (the 429 blocked the embed step), the dense leg returns nothing and the acceptance test is meaningless. Once Tim adds a payment method on Voyage, re-run the ingest without `--skip-embedding` and the acceptance test runs. Estimated unblock time: minutes, not hours.
- Full ingestion of all 4 fixture statutes (Constitution + DPA 2019 + Companies Act 2015 + KICA 1998). Only the Constitution has been touched. Same blocker.
- Persistent tag cache (Redis / Postgres) — Sprint 4.
- Day 5 work: playbook validator + Resend email webhook.

## DEFERRED.md updates

- **DEF-005 escalated** from `sprint:1 day 8` to `sprint:1 day 4`. Rewrote the entry with the actual rate-limit numbers (3 RPM / 10K TPM on free tier), the workaround (`--skip-embedding`), and clear remediation steps.
- **DEF-045 added** — adaptive batching + 429-aware retry for the Voyage embedder. The right fix once Tim's account is upgraded; protects against future spikes during eval-suite runs (Sprint 6+).

## Database state

All 6 migrations applied to Supabase project `rfgcgvafxdbpypzaokdh` (eu-west-2 London). Migration history shows 0001-0006 in sync.

```
Local | Remote
------|-------
0001  | 0001  (foundation)
0002  | 0002  (corpus tables)
0003  | 0003  (reviews)
0004  | 0004  (audit + hash chain)
0005  | 0005  (corpus retrieval RPCs)         [new today]
0006  | 0006  (explicit table grants)         [new today]
```

corpus_documents has 1 row (Constitution); corpus_chunks has 158 rows (all with `embedding = null` — pending DEF-005).

## Known issues / technical notes

- The chunker fix (AKN root selector) is generic Kenya-Law-statute-specific. Other Kenyan source types (judgments, ODPC determinations, gazette) will likely have their own selectors when scraping for them lands in Sprint 4. The current normaliser falls through to `main`/`#content`/`.content`/`body` for non-AKN content, so it shouldn't completely fail on other sources — just produce non-ideal chunks.
- Once Voyage is upgraded and ingestion runs cleanly, expect the Constitution alone to consume ~80K tokens of embedding budget. Four fixture statutes ≈ 250-400K tokens total. Voyage's 200M-token free quota easily covers this.
- The retrieval RPCs use `<=>` (cosine distance) and `1 - <=>` for similarity. Make sure new code reading `similarity` interprets it as "higher is more similar" (matches our score convention).

## Exact next step (Day 5) ⚠️ TWO TIM ACTIONS

1. **Lawyer engagement for `packages/playbooks/kenya/nda.yaml` review (DEF-028)** — start the conversation now even if review takes longer than Day 5. Sprint 1's playbook acceptance criterion is gated on this.
2. **Resend "Enable Receiving" + MX record on `ask.parasol.co.ke` at 101domain (DEF-001)** — needed for the email-intake route handler that lands today.
3. **(High priority but flexible)** Add a payment method on Voyage AI dashboard (DEF-005). Without it, Day 6 (eval harness) will hit the same rate limit and won't be able to score retrieval against the 20-NDA dataset.

Day 5 implementation work I'll do (in parallel with Tim's actions):
1. **`packages/playbooks/src/schema.ts`** — Zod schema matching `docs/playbook-schema.md`, validating all required fields and citation resolution.
2. **`packages/playbooks/src/validator.ts`** — `validatePlaybook(path)` loads YAML + schema-validates + checks every citation id resolves in the corpus.
3. **`packages/playbooks/src/loader.ts`** — `loadPlaybook(jurisdiction, contractType)` returning typed `PlaybookDefinition`.
4. **`pnpm playbooks:validate`** wired and passing on `kenya/nda.yaml` (modulo DEF-028 placeholders, which fail with clear error messages).
5. **`apps/web/src/app/api/inbound/email/route.ts`** — Resend webhook handler with Svix signature verification, sender domain whitelist, attachment extraction, returns 200 immediately and queues a pipeline run.
