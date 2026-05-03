# Handoff: Sprint 1, Day 2 — Repositories + AI client

Date: 2026-05-04
Session type: Sprint 1 Day 2

## What was completed

Day 2 scope per `docs/sprint-1-plan.md`: data access layer + AI client wrapper. Nothing calls Supabase or Anthropic directly from app code after today.

### Database typing (`packages/core/src/db.ts`)

- Hand-rolled `Database` type covering the four Day-2 tables: `workspaces`, `profiles`, `reviews`, `audit_log` (corpus + reviews-detail tables follow when their repositories land).
- Required `__InternalSupabase: { PostgrestVersion: '12.2.3' }` field for `@supabase/supabase-js` v2.45+ — without it, all `.from(...)` calls collapse to `never`.
- All Row/Insert/Update declared as `type` aliases (not `interface`) — interfaces fail Supabase's `GenericTable extends Record<string, unknown>` constraint.
- Auto-generation deferred per DEF-043 (needs Supabase PAT or Docker Desktop).

### Repository layer (`packages/core/src/repositories/`)

- `types.ts` — typed `SupabaseClient` alias (with `Database` baked in), `Tables<T>` and `TablesInsert<T>` helpers.
- `base.ts` — `BaseRepository` abstract class; takes a `SupabaseClient` at construction (app layer creates it; repos never construct their own).
- `workspaces.ts` — `WorkspaceRepository.getById / getBySlug / findBySlug`. Throws `NotFoundError` on miss, except `findBySlug` which returns `null`.
- `reviews.ts` — `ReviewRepository.create / getById / updateStatus`. `updateStatus(id, 'failed', errorMessage)` records the error message; success transitions don't.
- `audit.ts` — `AuditRepository.appendEvent / getLatestHash / verifyChain`. Hash chain implementation:
  - Genesis hash = SHA256(''), exported as `GENESIS_HASH`.
  - `computeChainHash({ id, actorId, action, payload, previousHash })` — pure deterministic function (matches the migration's formula `SHA256(id || actor_id || action || payload || previous_hash)`).
  - `stableStringify(value)` — order-independent JSON serialisation; required so re-serialised payloads produce identical hashes.
  - `verifyChain(workspaceId)` — recomputes every hash from genesis and returns the index of the first broken link.
  - **Concurrency caveat**: read-then-write pattern. Two simultaneous appends to the same workspace can race. Acceptable for Sprint 1's low volume; DEF-044 (Sprint 5) replaces this with a Postgres `append_audit_event` RPC that holds a row lock through the insert.

### AI orchestration (`packages/ai/src/`)

- `types.ts` — Stage interface, prompt artefacts, model role resolution. Notable shapes:
  - `PromptArtefact<TInput, TOutput>` — versioned, schema-validated prompt unit; lives in `packages/ai/src/prompts/<stage-name>.ts` (not yet populated; Day 7+).
  - `Stage<Input, Output>` — declares `modelRole`, `prompt`, `inputSchema`, `outputSchema`, `cacheable`, `retry`, `evalCases`, `run()`. Matches the contract documented in `docs/orchestration.md`.
  - `OrchestratorContext` — passed to `run()`; carries reviewId, workspaceId, jurisdiction, contractType, pre-loaded `playbookContext`, current-clause `authorityChunks`, an `emitEvent` hook for `pipeline_events`, and an optional `modelEnv` override for A/B testing (DEF-041).
  - `resolveModel(role, env?)` — reads `ANTHROPIC_MODEL_HAIKU/SONNET/OPUS` env vars, falls back to `DEFAULT_MODEL_BY_ROLE` constants.
- `client.ts` — Anthropic SDK wrapper. Singleton client lazy-initialised from `ANTHROPIC_API_KEY`. `createMessage({ modelRole, system, messages, maxTokens, modelEnv })` is the canonical call site.
  - `cachedTextBlock(text)` — produces a `cache_control: { type: 'ephemeral' }` text block for prompt caching of stable context (playbooks, system prompts).
  - `plainTextBlock(text)` — uncached counterpart for per-call dynamic content.
  - `overrideClient(client)` — test hook so unit tests can inject a `vi.fn`-based stub instead of a real SDK call.

### Supabase client factory split

- `apps/web/src/lib/supabase/server.ts` — typed `SupabaseClient<Database>` for Server Components / actions / route handlers (Day 1 file, now generic-typed).
- `apps/web/src/lib/supabase/browser.ts` — new `createBrowserClient()` for Client Components.
- `apps/web/src/server/auth.ts` — refactored `requireAuth` / `requireAdmin` around a shared `loadProfile()` helper to fix a TypeScript narrowing quirk where `redirect(...)` (whose return is `never`) collapsed the destructured `profile` to `never` instead of narrowing it to non-null.

## Tests added

| Suite | Tests | Notes |
|-------|-------|-------|
| `packages/core/src/repositories/audit.test.ts` | 18 | Pure-function tests for `GENESIS_HASH`, `stableStringify`, `computeChainHash`, plus end-to-end mock-Supabase tests for `appendEvent` and `verifyChain` (genesis bootstrap, chain linking, per-workspace separation, system-event chain, tamper detection in payload + previous_hash). |
| `packages/core/src/repositories/workspaces.test.ts` | 6 | `getById`, `getBySlug`, `findBySlug` happy/missing/error paths. |
| `packages/core/src/repositories/reviews.test.ts` | 8 | `create` defaults + overrides + missing-data, `getById`, `updateStatus` (success + failed-with-error-message + missing). |
| `packages/ai/src/client.test.ts` | 11 | `resolveModel` env precedence, `readEnvModels`, `cachedTextBlock` / `plainTextBlock` shape, `createMessage` SDK forwarding (model resolution, cached system passthrough, max_tokens default + override). |

Total Day 2 additions: **43 tests**. Cumulative repo tests: **86 passing** (43 from Day 1 — 21 errors, 22 PII scrub — plus 43 from Day 2).

## Verification evidence

```
pnpm turbo typecheck test lint --force
→ 18 successful, 18 total (6 packages × 3 tasks)
→ Zero TS errors, zero lint warnings, all tests green
```

## DEFERRED.md additions

- **DEF-043**: Auto-generate Database TypeScript types from Supabase schema (waiting on Supabase PAT or Docker Desktop)
- **DEF-044**: Atomic audit log append via Postgres RPC (Sprint 5; replaces the current read-then-write race-prone implementation)

## Database state

Unchanged from Day 1. All 4 migrations (`0001_foundation`, `0002_corpus`, `0003_reviews`, `0004_audit`) remain applied and in sync with `supabase migration list`.

## What is NOT done

- Corpus pipeline (Day 3): scraper, normaliser, chunker, embedder, tagger, seed script. Hard deadline depends on Tim's 20-NDA dataset arrival.
- Hybrid retrieval (Day 4): `retrieveAuthority(query, options)` with BM25 + pgvector + RRF + Voyage rerank.
- Playbook loader and validator (Day 5): Zod schema + citation-resolution check.
- Email intake webhook (Day 5).
- Eval harness (Day 6).
- Pipeline stages 1-4 — Haiku stages (Day 7).
- Pipeline stages 5-8 — Sonnet stages including `verify-citations` (Day 8).
- 20-NDA golden dataset — needed by Day 3 (Tim action + DEF-027).
- Lawyer review of `packages/playbooks/kenya/nda.yaml` — needed by Day 5 (DEF-028).
- Resend MX record for `ask.parasol.co.ke` — needed by Day 5 (Tim action, DEF-001).

## Known issues / technical notes

- **Hand-rolled Database type drift risk**: any new migration must be mirrored in `packages/core/src/db.ts` until DEF-043 lands. Mitigation: the `db:types` script is wired (`apps/web/package.json`); flipping to auto-generation is a one-line change once a PAT exists.
- **Audit chain race condition**: documented at the top of `appendEvent`. DEF-044 will fix this with a Postgres RPC. Not a Sprint 1 risk.
- **`tsconfig.json` cleanup**: removed `composite: true` and `references` from package tsconfigs. They were creating phantom `dist/` dependencies that broke `pnpm typecheck` from a clean state. With `main: "./src/index.ts"` in each package and pnpm workspace symlinks, cross-package type resolution flows through source files directly — no build step needed.

## Exact next step (Day 3)

⚠️ **GOLDEN DATASET DUE TODAY (2026-05-05)** — see Tim action below.

1. **kenyalaw.org scraper** — `packages/corpus/src/scrapers/kenyalaw.ts`. Polite scraper: 1 req / 2s, idempotent, respects robots.txt. Outputs `corpus_documents` rows for the Kenyan Constitution, all Acts, and a configurable cap on Court of Appeal / High Court judgments (start at 50 for the sprint fixture).
2. **Normaliser** — `packages/corpus/src/normaliser.ts`: HTML → clean structured text with section hierarchy preserved.
3. **Chunker** — `packages/corpus/src/chunker.ts`: section-aware ~500-token chunks; each chunk's `text_with_context` is prefixed with its hierarchy ("Act > Part > Section > ...").
4. **Embedder** — `packages/corpus/src/embedder.ts`: Voyage-3 batch embedding (128 per batch); writes `corpus_chunks.embedding`.
5. **Tagger** — `packages/corpus/src/tagger.ts`: Haiku-assisted `clause_type` + `area_of_law` tagging; cached by content hash.
6. **Seed script** — ingest at minimum DPA 2019, Companies Act 2015, Kenya Information & Communications Act 1998, plus 50 judgments as the sprint fixture corpus.

**Tim action for Day 3**: deliver 20 anonymised NDAs to `packages/eval/data/golden/nda/` with the ground-truth annotation template (DEF-027). Without these by end of day, the eval harness on Day 6 falls behind.
