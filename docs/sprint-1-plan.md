# Sprint 1 Day-by-Day Plan

Sprint 1 runs 14 days (2026-05-03 → 2026-05-16). Two parallel tracks: corpus+playbook in week 1, orchestration+surfaces+eval in week 2.

**Hard deadlines:**
- Day 3 (2026-05-05): 20-NDA golden dataset from Tim's network — **blocks eval harness**
- Day 5 (2026-05-07): Lawyer review of NDA playbook initiated (DEF-028) — **blocks playbook acceptance criterion**
- Day 5 (2026-05-07): Resend inbound MX live on ask.parasol.co.ke (DEF-001) — **Tim + Claude Code**
- Day 8 (2026-05-10): Voyage rerank-2 quota check (DEF-005) — **Tim reads dashboard**

---

## Week 1: Foundation + Corpus + Playbook

### Day 1 — 2026-05-03 (today)

**Goal:** Foundation infrastructure — every subsequent day can build on this without re-plumbing.

- [x] `docs/sprint-1-plan.md` (this file)
- [ ] Supabase migration infrastructure: `apps/web/supabase/config.toml` + migrations 0001-0004
  - `0001_foundation.sql`: pgvector extension, workspaces, profiles, playbook_overrides + RLS
  - `0002_corpus.sql`: corpus_sources, corpus_ingestion_runs, corpus_documents, corpus_chunks (vector + fts) + RLS
  - `0003_reviews.sql`: reviews, review_documents, extracted_clauses, issues, citations, pipeline_events + RLS
  - `0004_audit.sql`: audit_log (append-only with hash chain) + RLS
- [ ] `packages/core/src/`: domain types (Jurisdiction, ClauseType, ContractType, ConfidenceLevel, etc.) + AppError hierarchy
- [ ] Vitest config in `packages/core/` and `apps/web/`
- [ ] AppError hierarchy unit tests
- [ ] `apps/web/src/lib/pii-scrub.ts` + tests (DEF-008 implementation)
- [ ] Sentry configs (DSN-guarded; scrub uses pii-scrub.ts)
- [ ] `apps/web/next.config.ts`
- [ ] `pnpm typecheck` + `pnpm lint` clean

**Tim actions today:**
- Register parasol.co.ug, parasol.co.tz, parasol.co.rw (DEF-011)
- Run `supabase link --project-ref <ref>` and `pnpm db:migrate` to apply migrations
- Activate network to source 20 NDAs for golden dataset (due day 3)

---

### Day 2 — 2026-05-04

**Goal:** Data access layer + AI client wrapper. Nothing calls the DB or Anthropic directly from pages after today.

- [ ] `packages/core/src/repositories/`: base repository interface + Supabase client factory (`createServerClient`, `createBrowserClient` via `@supabase/ssr`)
- [ ] `packages/core/src/repositories/workspaces.ts`: `getWorkspaceBySlug`, `getWorkspaceById`
- [ ] `packages/core/src/repositories/reviews.ts`: `createReview`, `getReviewById`, `updateReviewStatus`
- [ ] `packages/core/src/repositories/audit.ts`: `appendAuditEvent` (with hash chain logic)
- [ ] `packages/ai/src/client.ts`: Anthropic SDK wrapper with prompt caching (cache_control on system prompts + playbook context)
- [ ] `packages/ai/src/types.ts`: Stage interface, PromptArtefact, OrchestratorContext, ModelRole resolution
- [ ] Unit tests for audit hash chain; unit tests for repository layer against Supabase test fixtures
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### Day 3 — 2026-05-05 ⚠️ GOLDEN DATASET DUE

**Goal:** Corpus ingestion pipeline — kenyalaw.org scraper, chunker, embedder.

- [ ] `packages/corpus/src/scrapers/kenyalaw.ts`: polite scraper for Constitution + Acts + 2,000 Court of Appeal/High Court judgments
  - Rate limit: 1 req/2s; idempotent; respect robots.txt
  - Outputs: `corpus_documents` rows
- [ ] `packages/corpus/src/normaliser.ts`: HTML → clean structured text; hierarchy preservation
- [ ] `packages/corpus/src/chunker.ts`: section-aware chunking (~500 tokens, hierarchy-prefixed `text_with_context`)
- [ ] `packages/corpus/src/embedder.ts`: Voyage-3 batch embedding (128 per batch); writes `corpus_chunks.embedding`
- [ ] `packages/corpus/src/tagger.ts`: Haiku-assisted clause_type + area_of_law tagging; cached by content hash
- [ ] Seed script: ingest at minimum DPA 2019, Companies Act 2015, Kenya Information and Communications Act 1998 + 50 judgments as sprint fixture corpus
- [ ] **Tim:** deliver 20 NDAs (anonymised) to `packages/eval/data/golden/nda/` with ground-truth annotation template

---

### Day 4 — 2026-05-06

**Goal:** Hybrid retrieval. The `retrieveAuthority` function must pass the DPA s.49 test before day 5.

- [ ] `packages/corpus/src/retrieval.ts`: `retrieveAuthority(query, options)` full implementation
  - BM25 via Postgres FTS (`ts_rank_cd`)
  - Dense retrieval via pgvector cosine similarity
  - Reciprocal rank fusion merge
  - Voyage rerank-2 on top-30 RRF results
  - Clause-type + jurisdiction filters
- [ ] `packages/corpus/src/retrieval.test.ts`: integration test — "data protection cross-border transfer" returns DPA 2019 s.49 in top 3
- [ ] `packages/corpus/src/index.ts`: barrel export
- [ ] `pnpm corpus:ingest:kenya` smoke test against dev Supabase; verify embedding count in dashboard

---

### Day 5 — 2026-05-07 ⚠️ LAWYER REVIEW + RESEND MX

**Goal:** Playbook validation infrastructure; email intake endpoint ready for Tim to wire.

- [ ] `packages/playbooks/src/schema.ts`: Zod schema matching `docs/playbook-schema.md`; validates all required fields, citation resolution against corpus
- [ ] `packages/playbooks/src/validator.ts`: `validatePlaybook(path)` loads YAML + validates against schema + checks citation IDs resolve in corpus
- [ ] `pnpm playbooks:validate` script wired and passing on the existing `kenya/nda.yaml` (modulo DEF-028 placeholders — those fail with clear error messages)
- [ ] `packages/playbooks/src/loader.ts`: `loadPlaybook(jurisdiction, contractType)` → typed PlaybookDefinition
- [ ] `apps/web/src/app/api/inbound/email/route.ts`: Resend webhook handler
  - Svix signature verification using `RESEND_INBOUND_WEBHOOK_SECRET`
  - Sender domain whitelist check
  - Attachment extraction
  - Queues pipeline run; returns 200 immediately
- [ ] **Tim:** confirm lawyer engagement started (DEF-028)
- [ ] **Tim:** toggle Resend "Enable Receiving", add MX record on `ask` subdomain at 101domain (DEF-001)

---

### Day 6 — 2026-05-08

**Goal:** Eval harness skeleton. CI fails on eval regression from this day forward.

- [ ] `packages/eval/src/runner.ts`: loads golden NDAs, runs full pipeline, collects per-NDA scores
- [ ] `packages/eval/src/metrics.ts`: clause identification precision/recall, redline appropriateness (1-5), citation validity rate, hallucination rate
- [ ] `packages/eval/src/reporter.ts`: writes `packages/eval/results/sprint-1.json`; prints summary table
- [ ] `packages/eval/data/golden/nda/`: ground-truth annotation YAML schema + at least 5 annotated NDAs (full 20 by day 13)
- [ ] CI: `.github/workflows/ci.yml` eval gate wired — fails PR if citation validity drops below 100% or hallucination rate rises above 2%
- [ ] `pnpm eval` runs successfully (even against a stub pipeline)

---

### Day 7 — 2026-05-09

**Goal:** Orchestration stages 1-4 (the cheap Haiku stages).

- [ ] `packages/ai/src/prompts/quality-assess.ts`: prompt artefact + output schema (PageQuality)
- [ ] `packages/ai/src/prompts/extract-text-clean.ts`: Haiku clean extraction prompt
- [ ] `packages/ai/src/prompts/extract-text-degraded.ts`: Sonnet vision extraction prompt
- [ ] `packages/ai/src/prompts/triage.ts`: contract type + jurisdiction + parties identification
- [ ] `packages/ai/src/prompts/extract-clauses.ts`: structured clause decomposition
- [ ] `packages/ai/src/stages/`: one file per stage above, each exporting a `Stage<Input, Output>` with `modelRole`, Zod schemas, `run()`
- [ ] `packages/ai/src/orchestrator.ts`: shell of the orchestrator; stages 1-4 wired; stages 5-10 stub (return empty)
- [ ] Unit tests for triage stage output schema conformance against 5 NDA fixtures
- [ ] `pnpm typecheck` clean on `@parasol/ai`

---

## Week 2: Orchestration Complete + Surfaces + Eval

### Day 8 — 2026-05-10 ⚠️ VOYAGE QUOTA CHECK

**Goal:** Heavy reasoning stages — the core of the product.

- [ ] `packages/ai/src/prompts/compare-playbook.ts`: Sonnet prompt; playbook context cached; outputs clause-level deviation objects
- [ ] `packages/ai/src/prompts/generate-redline.ts`: Sonnet prompt; playbook + corpus chunks cached; outputs issues + redline text + citations
- [ ] `packages/ai/src/prompts/verify-citations.ts`: Sonnet + deterministic validator; every cited authority resolved in corpus
- [ ] `packages/ai/src/stages/compare-playbook.ts`, `generate-redline.ts`, `verify-citations.ts`
- [ ] Citation validator deterministic layer: `packages/ai/src/citation-validator.ts` — resolves every citation against `corpus_documents`; fails pipeline on 0 resolving cites
- [ ] Confidence calibration: high → medium on citation failure; medium → manual-review on citation failure
- [ ] Orchestrator stages 5-8 wired end-to-end
- [ ] **Tim:** check Voyage AI dashboard quota (DEF-005); report back

---

### Day 9 — 2026-05-11

**Goal:** Final pipeline stages + end-to-end smoke test.

- [ ] `packages/ai/src/prompts/defined-terms-check.ts` + stage
- [ ] `packages/ai/src/stages/assemble-output.ts`: .docx tracked-change generation (docxtemplater), email body assembly, web view JSON
- [ ] Orchestrator fully wired (all 10 stages)
- [ ] End-to-end integration test: submit one real NDA → receives `issues` array + `review_documents` (redlined .docx)
- [ ] p95 latency measured on 3 test NDAs; confirm < 60s
- [ ] All pipeline_events written to DB; audit_log entry on review completion

---

### Day 10 — 2026-05-12

**Goal:** Email intake surface complete.

- [ ] Email route handler wired fully to orchestrator pipeline
- [ ] Reply assembly: Resend outbound with redlined .docx attachment + structured summary body
- [ ] Sender domain allowlist enforcement (polite explainer to unknown senders)
- [ ] Webhook signature verification integration test (Svix replay attack prevention)
- [ ] `pnpm test` passes including email integration tests against Resend test fixture
- [ ] End-to-end: forward a real NDA to `test@ask.parasol.co.ke`; receive reply within 90s

---

### Day 11 — 2026-05-13

**Goal:** Web upload UI.

- [ ] `apps/web/src/app/review/new/page.tsx`: drag-and-drop / click upload (.docx + PDF); file validation; pipeline trigger
- [ ] Progress indicator component: streams stage updates (Identifying clauses → Applying playbook → Verifying citations → Generating redline)
- [ ] `apps/web/src/app/review/[id]/page.tsx`: structured issue list; severity grouping; confidence badges; download redline button
- [ ] All actions write `audit_log` entries
- [ ] Matches BRAND.md design system (no amber as decoration; sentence case; Söhne/Söhne Mono)
- [ ] Auth guard: redirect to `/login` if unauthenticated

---

### Day 12 — 2026-05-14

**Goal:** Corpus admin UI complete.

- [ ] `apps/web/src/app/admin/corpus/page.tsx`: full implementation replacing stub
  - Health summary: total_documents, total_chunks, healthy_sources, pending_diffs
  - Sources list: per-source status, schedule (read-only display), last_run_at, document_count
  - Recent runs: last 7 days with status + document counts
  - "Run now" button per source → POST `/api/admin/corpus/sources/[id]/run` → real ingestion trigger
  - Run state updates in UI (polling or SSE)
- [ ] `apps/web/src/app/api/admin/corpus/sources/route.ts`: GET sources list (implemented, not stub)
- [ ] `apps/web/src/app/api/admin/corpus/runs/route.ts`: GET recent runs (implemented, not stub)
- [ ] `apps/web/src/app/api/admin/corpus/sources/[id]/run/route.ts`: POST triggers incremental ingestion
- [ ] All admin actions write `audit_log` entries namespaced `admin.corpus.*`
- [ ] UI matches parasol_corpus_admin design from chat artefacts (2026-05-03)

---

### Day 13 — 2026-05-15

**Goal:** Eval harness acceptance bar.

- [ ] All 20 NDAs annotated in `packages/eval/data/golden/nda/`
- [ ] `pnpm eval` full run: ≥85% clause identification, ≥80% redline appropriateness, <2% hallucination rate, 100% citation validity
- [ ] Results committed to `packages/eval/results/sprint-1.json`
- [ ] Eval summary written in HANDOFF.md
- [ ] Prompt/playbook tuning if below bar (this day is the tuning buffer)

---

### Day 14 — 2026-05-16

**Goal:** Sprint close.

- [ ] `pnpm typecheck` + `pnpm test` + `pnpm lint` all clean
- [ ] `pnpm eval` acceptance bar confirmed
- [ ] DEFERRED.md hygiene: sprint-1 items either completed and moved to Completed, or carried with notes
- [ ] HANDOFF.md updated with evidence for every acceptance criterion
- [ ] Git history clean (no wip commits; each commit is a changelog entry)
- [ ] Evaluator agent session run; score ≥90% per CLAUDE.md rubric

---

## Notes

**Corpus ingestion risk:** kenyalaw.org may rate-limit or change structure mid-sprint. The scraper circuit-breaker (DEF-020) is Sprint 8; for Sprint 1, build robust error logging and manual fallback (manually download Acts as HTML if scraper is blocked).

**Eval dataset risk:** If Tim's network yields fewer than 20 NDAs, substitute with publicly available Kenyan NDA templates (law firm precedents from public websites) for the remaining slots. Expert annotation can be partial (critical clauses only) for the substitute NDAs. Flag in HANDOFF.md.

**Latency risk:** The 60s p95 target across 10 stages with Sonnet and retrieval is achievable but tight. Stages 1-4 in parallel, stages 5-7 sequential, stage 9 parallel to 5-7, stage 10 awaits all — this is the orchestrator design from `docs/orchestration.md`. Any stage exceeding 20s in isolation should be flagged immediately.
