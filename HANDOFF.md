# Handoff: Sprint 1, Day 12 — Corpus admin UI complete

Date: 2026-05-05
Session type: Sprint 1 Day 12

## What was completed

Day 12 ships the corpus admin surface. parasol_admins land on `/admin/corpus` and see the live health summary, the sources table with status pills + last-run timestamps, the "Run now" button per source, and the recent-runs panel. Triggering a run kicks off an `ingestSource` execution in the background via `next/server.after()`, with `admin.corpus.run_triggered` and `admin.corpus.run_completed` (or `run_failed`) audit-log entries on either side.

### CorpusRepository extensions (`packages/corpus/src/repository.ts`)

- **`listRuns({ limit?, sourceId? })`** — recent ingestion runs, newest first, default 50, optional per-source filter. Used by both the runs panel and the future `/api/admin/corpus/runs` consumer.
- **`healthSummary()`** — aggregate metrics for the dashboard top card. Uses Postgres `count: 'exact', head: true` to avoid streaming rows; classifies `status` into `healthy` (`healthy` + `idle`) and `errored` (`error` + `warning`) buckets so the surface highlights what needs operator attention.

### Admin audit helper (`apps/web/src/server/audit.ts`)

`logAdminEvent({ supabase, actorId, workspaceId, action, resourceType?, resourceId?, payload?, ipAddress?, userAgent? })` wraps `AuditRepository.appendEvent` and **swallows errors** — an audit-write failure must not abort the underlying admin operation, but it must be loud (logs to `console.error`). `extractRequestContext({ headers })` pulls the IP from the first X-Forwarded-For entry and the User-Agent for forensic context. Both null-safe.

### API routes (auth-gated to parasol_admin → 404 on non-admin)

- **`GET /api/admin/corpus/sources`** — returns the configured corpus_sources. POST returns 501 (deferred to Sprint 2 per the playbook-coverage matrix gate).
- **`GET /api/admin/corpus/runs?source=<id>&limit=<n>`** — recent runs with optional source filter; limit clamped to [1, 200] with default 50.
- **`POST /api/admin/corpus/sources/[id]/run`** — auth-guarded run-now trigger. Resolves the source by id, looks up a Scraper for its slug (Sprint 1 only registers `kenya-acts` → KenyaLawScraper; ODPC + KRA register here as they ship), writes a `admin.corpus.run_triggered` audit row before the response, then invokes `ingestSource` via `after()`. The completion path writes `admin.corpus.run_completed` (or `_failed`) with the document add/update counts in the payload. Skips embedding/tagging when the relevant API key isn't configured — Sprint 1 escape hatch for dev environments without Voyage / Anthropic keys.

CLAUDE.md routing: all admin routes return `404` (not `403`) for non-admins. Both `UnauthorisedError` and `ForbiddenError` are mapped to 404 via `adminAuthErrorResponse`.

### `/admin/corpus` page (`apps/web/src/app/admin/corpus/page.tsx`)

Replaces the Day 1 stub. Server component reading via `CorpusRepository` directly (no API round-trip needed in-process). Renders:

- Stats summary row — Documents, Chunks, Healthy sources, Errored
- Sources table — name + slug (mono), jurisdiction, status pill, document count, relative last-run time, "Run now" button
- Recent runs table — source slug, started time, status pill, documents added / updated, error count, run duration

The `RunNowButton` is a client component that posts to the run-now endpoint and calls `router.refresh()` on 202 so the runs panel reflects the new in-flight row.

`globals.css` extended with an `.admin-table` style (warm-grey header band, 0.5px row dividers, 14px body font). Severity pill classes are reused for the status indicators — corpus health is genuinely a severity-coded state.

## Tests added (24 new — corpus 63 → 68, web 96 → 115)

| Suite | Tests |
|-------|-------|
| `packages/corpus/src/repository.test.ts` | 5 — `listRuns` (default order/limit, `sourceId` filter, error rethrow), `healthSummary` (aggregation + status bucketing, error rethrow) |
| `apps/web/src/server/audit.test.ts` | 6 — `logAdminEvent` (forwards full input shape, swallows persistence errors with console.error, defaults null fields), `extractRequestContext` (XFF first-entry, no headers, single-IP) |
| `apps/web/src/app/api/admin/corpus/sources/route.test.ts` | 4 — happy path admin GET, UnauthorisedError → 404, ForbiddenError → 404, POST returns 501 |
| `apps/web/src/app/api/admin/corpus/runs/route.test.ts` | 4 — default limit 50, `?source=` + `?limit=` passthrough, limit clamped to 200, non-admin 404 |
| `apps/web/src/app/api/admin/corpus/sources/[id]/run/route.test.ts` | 5 — happy path (run_triggered audit + ingestSource invoked + run_completed audit), unknown source → 404, no scraper for slug → 422, ingestSource throw → run_failed audit, non-admin 404 |

Cumulative repo test count: **424 passing across 6 packages** (+24 today).

| Package | Tests |
|---------|-------|
| `@parasol/core` | 66 |
| `@parasol/playbooks` | 38 |
| `@parasol/eval` | 42 |
| `@parasol/web` | 115 (+19) |
| `@parasol/corpus` | 68 (+5) |
| `@parasol/ai` | 95 |

## Verification evidence

```
pnpm turbo typecheck test lint --force
→ 18/18 successful, 424 tests passing
→ Zero TS errors, zero lint warnings
```

## What is NOT done

- **Streaming run progress in the UI** — the Run Now button + `router.refresh()` shows the new in-flight row but doesn't stream document-by-document progress. DEF-049 (SSE / RSC streaming, deferred from Day 11) covers both surfaces (review polling + admin runs).
- **Source creation / editing UI** — `POST /api/admin/corpus/sources` returns 501. Sprint 1 ships read-only + run-now; new sources land in Sprint 2 alongside the playbook-coverage matrix.
- **Scheduled cron path** — DEF-017 / DEF-018 cover daily incremental + weekly Gazette diff. Day 12 ships only the manual trigger.
- **Pending-diff review screen** — DEF-019 (`/admin/corpus/diffs`). The diff queue is captured by ingestion but no UI exists yet.
- **Source-level circuit breakers / Slack alerting** — DEF-020.
- **`new KenyaLawScraper()` constructed without env-tuned `politeFetch` options** — Sprint 1 dev runs use the default 2-second polite-interval. For production-cron runs we'll want to thread through a configured fetcher; small change when DEF-017 lands.

## Known issues / technical notes

- **Auth surface for non-admins is 404 by design** (CLAUDE.md). Both "not signed in" and "signed in but not admin" return 404 — the existence of the admin surface should not be discoverable from the public app. Admin tests verify both branches.
- **`status === 'running'` disables the Run Now button** but doesn't free the lock — if a run gets stuck the source stays disabled until an admin manually updates the row. DEF-020 (circuit breakers + alerting) is the right place for the recovery flow.
- **Health summary is not cached**: every page load runs three queries against `corpus_documents`, `corpus_chunks`, `corpus_sources`. With Sprint 1 row counts this is fine; once the corpus crosses 50k chunks we should memo this with a 60-second TTL or move to a materialised view.
- **Source slug → scraper mapping is hardcoded in `makeScraper()`**: a switch statement in the run-now route. As we add scrapers (ODPC, KRA, CBK) each registers here. There's no plugin discovery — intentional, since each scraper has bespoke handling (Akoma Ntoso for Kenya Law, PDF extraction for ODPC, etc.).
- **Background runs don't surface failures back to the user**: if `ingestSource` throws after the response has flushed, the user has to refresh and read the runs panel. The `admin.corpus.run_failed` audit row is the durable record. SSE streaming (DEF-049) closes this.

## Database state

No migrations today. Day 11's migration 0007 is still pending Tim's `pnpm db:migrate` for the dev project.

## Exact next step (Day 13) — Eval harness acceptance bar

Day 13 plan from `docs/sprint-1-plan.md`:
1. **All 20 NDAs annotated** in `packages/eval/data/golden/nda/` — Tim's golden dataset (sourced Day 3) with manual ground-truth labels for clause identification + expected playbook deviations + cited authority.
2. **`pnpm eval` full run** producing the Sprint 1 acceptance metrics:
   - ≥85% clause identification F1
   - ≥80% redline appropriateness (rubric scoring)
   - <2% hallucination rate
   - 100% citation validity
3. **Results committed to `packages/eval/results/sprint-1.json`**
4. **Latency measurements** on 3 representative NDAs (target: 60s p95)

Day 13 also reflects on whether to (a) re-introduce parallel stage 9 (deferred from Day 9), (b) tighten `maxDuration` from 120 back to 60 on the route handlers, and (c) measure citation-validity-rate against the live corpus to set the v1 acceptance bar for Sprint 8.

## Tim action items

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): not blocking Sprint 1.
- **`pnpm db:migrate`** — apply migration 0007 (still outstanding from Day 11). Web upload flow needs this; email path runs without it but loses inline artefact storage.
- **20 annotated NDAs** for Day 13 eval — sourced Day 3, but the per-document ground-truth labels still need a pass before the eval harness can compute F1.
