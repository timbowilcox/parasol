# Handoff: Sprint 1, Day 1 — Foundation infrastructure

Date: 2026-05-03
Session type: Sprint 1 Day 1

## What was completed

Sprint 1 day-1 scope: foundation infrastructure, database migrations, domain types, PII scrubbing, Sentry integration (DSN-guarded), ESLint v9 flat config, Vitest across all packages.

### Database migrations (apps/web/supabase/)

- `config.toml` — Supabase CLI config; Tim must `supabase link --project-ref <ref>` and then `pnpm db:migrate` before day-3 work touches Supabase.
- `0001_foundation.sql` — `workspaces`, `profiles`, `playbook_overrides` tables with full RLS policies.
- `0002_corpus.sql` — `corpus_sources` (with 6 Kenya authority seed rows), `corpus_ingestion_runs`, `corpus_documents`, `corpus_chunks`. HNSW index (m=16, ef_construction=128) on `embedding vector_cosine_ops`. GIN index on `fts` tsvector and `clause_types`. RLS: authenticated SELECT on corpus tables, admin-only on runs.
- `0003_reviews.sql` — `reviews`, `review_documents`, `extracted_clauses`, `issues`, `citations`, `pipeline_events` with full workspace-scoped RLS.
- `0004_audit.sql` — `audit_log` append-only table with `previous_hash / hash` chain. No UPDATE/DELETE policies at DB level. INSERT for workspace members, SELECT for admins only.

### Core package (packages/core/src/)

- `types/index.ts` — Full domain type vocabulary: `Jurisdiction`, `ContractType`, `ClauseType` (40 values), `CitationSource`, `Citation` (structured object, no stringly-typed citations), `ModelRole`, `ReviewStatus`, `AuditAction`, and supporting enums.
- `errors/index.ts` — AppError hierarchy: `AppError → NotFoundError, UnauthorisedError, ForbiddenError, ValidationError, ConflictError, PipelineError → CitationValidationError, IntakeError → UnsupportedFormatError, UnsupportedContractTypeError, FileTooLargeError, QualityTooLowError, CorpusError → EmbeddingError`. All `code` values passed via constructor chain to avoid readonly violations.
- `errors/errors.test.ts` — 21 tests; 100% coverage of hierarchy.
- `vitest.config.ts` — Vitest with `passWithNoTests: true`.

### PII scrubbing (apps/web/src/lib/)

- `pii-scrub.ts` — Framework-agnostic `scrubEvent()` targeting Sentry event shape. Scrubs: top-level message, exception values, user object (keeps only `id`), request body (fully redacted), request headers (sensitive-field check), `extra`, `contexts`. Sensitive field patterns are compound-name-aware (e.g., `accessToken`, `ANTHROPIC_API_KEY`, `senderEmail`).
- `pii-scrub.test.ts` — 22 tests.

### Sentry integration (apps/web/)

- `sentry.client.config.ts` — `Sentry.init()` guarded by `process.env.NEXT_PUBLIC_SENTRY_DSN`; `beforeSend` calls `scrubEvent()` with double-cast for type compatibility.
- `sentry.server.config.ts` — Same pattern, uses `process.env.SENTRY_DSN`.
- `next.config.ts` — `withSentryConfig()` wrapper; source maps uploaded in CI only.

Note: No Sentry DSN is configured. Tim confirmed this is intentional for Sprint 1. When a DSN is set in `.env.local` or Vercel, both configs activate automatically.

### Server-side utilities (apps/web/src/)

- `lib/supabase/server.ts` — `createServerClient()` factory using `@supabase/ssr`; `setAll` swallows errors in Server Component context (read-only cookies).
- `server/auth.ts` — `requireAuth()` (redirect to /login on failure) and `requireAdmin()` (throws `ForbiddenError` → 404 for non-admins per CLAUDE.md "intentionally undiscoverable").

### Build tooling

- `eslint.config.mjs` (root) — ESLint v9 flat config for all packages: `@eslint/js` + `typescript-eslint` recommended, `no-console: error`, `@typescript-eslint/no-explicit-any: error`.
- `apps/web/eslint.config.mjs` — Extends `eslint-config-next/core-web-vitals` (which exports a native flat config in v16) plus the two rules above.
- Note: Next.js 16 removed the `next lint` subcommand. `apps/web` lint script changed to `eslint src`.
- `vitest.config.ts` files created for all 6 packages. Packages without src content yet (ai, corpus, eval, playbooks) have `passWithNoTests: true` and stub `src/index.ts`.
- `@sentry/nextjs` updated to `^10.0.0` (v8 only supports Next.js ≤ 15; v10 supports Next.js 16).
- `@anthropic-ai/sdk` in `packages/ai` updated to `^0.92.0` (^0.34.0 had no stable release).

### sprint-1-plan.md

- `docs/sprint-1-plan.md` — Day-by-day 14-day breakdown with hard deadlines called out (Day 3: golden dataset, Day 5: lawyer review + Resend MX, Day 8: Voyage quota confirmation) and Tim action items flagged per day.

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18 successful, 18 total (6 packages × 3 tasks)
→ Core: 21 tests passing
→ Web: 22 tests passing (PII scrub suite)
→ All other packages: pass with no test files (expected, Day 2+ adds implementations)
```

TypeScript: zero errors across all packages. Lint: zero warnings. All tests green.

## What is NOT done

- Database migrations not applied to Supabase dev project (Tim action: `supabase link --project-ref <ref>` then `pnpm db:migrate`).
- Repository layer (`packages/core/src/repositories/`) — Day 2.
- AI client wrapper (`packages/ai/src/client.ts`) — Day 2.
- Prompt versioning system (`packages/ai/src/prompts/`) — Day 2.
- Document intake pipeline — Day 4+.
- Corpus ingestion client — Day 5+.
- Playbook loader and validator — Day 2.
- Review orchestration — Day 6+.
- Web UI (review surfaces, workspace management) — Day 8+.
- 20-NDA golden dataset for eval — needed by Day 3 (Tim action + DEF-027).
- Lawyer review of `packages/playbooks/kenya/nda.yaml` — needed by Day 5 (DEF-028).
- Resend MX record for `ask.parasol.co.ke` — needed by Day 5 (Tim action, DEF-001).
- Supabase project linked and migrations applied — needed by Day 3 (Tim action).

## Known issues / technical notes

- The `@parasol/ai`, `@parasol/corpus`, `@parasol/eval`, `@parasol/playbooks` packages have stub `src/index.ts` (`export {}`) only. Linting and typecheck pass; vitest passes with `passWithNoTests: true`. These stubs will be replaced starting Day 2.
- Turbo outputs warnings "no output files found for task test" because `vitest run` doesn't generate coverage files (no `--coverage` flag yet). These are warnings only, not failures; they'll go away when coverage is wired in Sprint 3.
- The `.env.example` includes `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`. Per CLAUDE.md, DSNs are not secrets (they're embedded in browser bundles). These can be committed to `.env.example`.

## Exact next step (Day 2)

1. **Repository layer** — `packages/core/src/repositories/`: `WorkspaceRepository`, `ReviewRepository`, `CorpusRepository`. Each uses the repository pattern (thin API routes, thick repositories). Thin Supabase client wrapper; no `service_role` in app code.
2. **AI client wrapper** — `packages/ai/src/client.ts`: Anthropic SDK singleton, model-role resolver (`haiku → claude-haiku-4-5-20251001`, `sonnet → claude-sonnet-4-7-20251001` for Sprint 1), prompt-cache configuration, retry logic.
3. **Prompt versioning** — `packages/ai/src/prompts/`: Versioned prompt registry. Each prompt has a name, version, modelRole, and content. Prompts are exported as typed objects, not raw strings.
4. **Playbook loader** — `packages/playbooks/src/loader.ts`: Load and Zod-validate YAML playbooks at runtime; export typed `Playbook` objects for use in the pipeline.

Before starting Day 2, confirm with Tim:
- Supabase project ref for `supabase link` (needed before any repository work that touches the real DB).
- Whether the 20-NDA dataset has been sourced (needed by end of Day 3 to stay on schedule).
