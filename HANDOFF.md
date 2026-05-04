# Handoff: Sprint 1, Day 11 — Web upload UI + review page + persistence

Date: 2026-05-05
Session type: Sprint 1 Day 11

## What was completed

Day 11 delivers the web-intake surface. Customers (and dev users) can now drop a contract at `/review/new`, get redirected to `/review/[id]`, watch the auto-refreshing status banner, and read the structured findings + download the redlined DOCX once processing completes. The relational tables (`extracted_clauses`, `issues`, `citations`) are now populated by the orchestrator's run so the review page renders without re-running the pipeline.

### Migration 0007 — review artefacts inline storage

Adds three columns to `reviews`:
- `redline_docx_base64 text` — the DOCX bytes encoded inline. Sprint 1 NDAs are 5-50 KB; comfortably under Postgres row limits. v2 migrates to Supabase Storage (DEF-048 — new this session).
- `web_view_json jsonb` — the assembled web view payload (`AssembledOutput.webView`). Hydrates `/review/[id]` without re-running the orchestrator.
- `email_body_json jsonb` — `{ subjectSuffix, plainText, html }` exactly as sent in the Resend reply. Audit trail for the email path.

### Persistence repositories (`packages/core/src/repositories/review-content.ts`)

`ExtractedClauseRepository`, `IssueRepository`, `CitationRepository` — each with `insertMany(rows)` returning the inserted rows (so the caller can chain insert citations against newly-issued issue IDs) and a `listForReview(id)` / `listForIssues(issueIds)` reader. Empty-input fast paths short-circuit Supabase calls. `ReviewRepository.updateAssembled()` writes the three new artefact columns in a single update.

### `processReview` refactor — discriminated attachment source

The Day 10 helper signature was email-specific. Day 11 generalises:

```ts
type AttachmentSource =
  | { kind: 'email'; inboundEmailId; attachmentId; filename }
  | { kind: 'inline'; bytes; mimeType; filename }

type ProcessReviewInput = {
  supabase, reviewId, workspaceId, attachment: AttachmentSource,
  replyEmail?: { replyTo, emailMessageId, originalSubject }
}
```

Email path: `attachment.kind === 'email'` + `replyEmail` set → fetches via Resend + sends reply. Web path: `attachment.kind === 'inline'` (bytes already in hand from the multipart upload) + no `replyEmail` → no reply email is sent; the `/review/[id]` page surfaces the result. Both paths run the same orchestrator and persist via `persistOutputs` (clauses → issues → citations → assembled artefacts on the review row).

### Web pages

- **Root `/` (`apps/web/src/app/page.tsx`)** — Sprint 1 placeholder linking to `/review/new` and `/admin/corpus`.
- **`/login`** — Sprint 1 stub. Real auth lands Sprint 2; this page documents the redirect target so `requireAuth()` doesn't 404 in dev.
- **`/review/new`** — server component (auth guard via `requireAuth`) + client `UploadDropzone` component. Drag-drop + click-to-browse; client-side validation of MIME + extension + 10 MB cap; posts multipart to `/api/upload`; redirects to `/review/[id]` on 202.
- **`/review/[id]`** — server component, RLS-scoped lookup. Branches on `review.status`:
  - `pending` / `processing` → `<meta http-equiv="refresh" content="5">` polls until completion (DEF-049 replaces with SSE/RSC streaming for v1 launch).
  - `failed` → status banner with `error_message` + retry CTA.
  - `unsupported` → status banner explaining what Sprint 1 supports + retry CTA.
  - `completed` → severity summary + per-issue cards (severity pill / clause id / confidence dot / current → recommended → reasoning → proposed redline → cited authority with `validated`/`unverified` styling) + extracted-clause reference list + "Download redlined .docx" button.

### Layout + design system (`apps/web/src/app/layout.tsx`, `globals.css`)

Root layout shipping the BRAND.md-aligned design tokens: warm-white surfaces (`#F1EFE8` page background, `#FFFFFF` card primary), severity ramp pairs as CSS custom properties, sentence-case throughout, no decorative amber, two type weights only (400 / 500), serif page titles + sans body + mono citations. Components reference token names (`--bg-primary`, `--critical-fill`, `--font-serif`) so the dark-mode pass (Sprint 6+) is a single root-rule swap.

### API routes

- **`POST /api/upload`** — auth-guarded multipart handler. Validates type / size / extension; creates the `reviews` row scoped to the caller's workspace; reads bytes once and hands off to `processReview` via `next/server.after()`. `maxDuration = 120` matches the email path. Returns `{ reviewId }` for the dropzone to redirect against.
- **`GET /api/review/[id]/redline.docx`** — auth-guarded redline download. Decodes the inline base64 column and streams it back with `Content-Type: ...wordprocessingml.document` + `Content-Disposition: attachment; filename="<original>-redlined.docx"` + `Cache-Control: private, no-store`. Returns 404 with `redline_unavailable` when the review hasn't completed.

### Email route handler updates

The Day 10 inbound webhook handler updated to use the new `processReview` shape — `attachment: { kind: 'email', ... }` + `replyEmail: { ... }`. No behaviour change.

## Tests added (16 new — apps/web 86 → 96, core 60 → 66)

| Suite | Tests |
|-------|-------|
| `packages/core/src/repositories/review-content.test.ts` | 6 — ExtractedClauseRepo (empty-input fast path, happy-path insert, error rethrow), IssueRepo (returns inserted rows for citation-foreign-key chaining), CitationRepo (empty-input fast path, `.in('issue_id', ids)` query) |
| `apps/web/src/app/api/upload/route.test.ts` | 6 — happy-path PDF upload (review created + processReview invoked with correct shape), missing-file 400, unsupported-MIME 415, file-too-large 413, empty-file 400, octet-stream + .docx filename → resolved DOCX MIME |
| `apps/web/src/app/api/review/[id]/redline.docx/route.test.ts` | 4 — happy-path 200 with bytes + content-disposition, 404 on missing review, 404 on review not yet completed, fallback filename when original is null |

Cumulative repo test count: **400 passing across 6 packages** (+16 today).

| Package | Tests |
|---------|-------|
| `@parasol/core` | 66 (+6) |
| `@parasol/playbooks` | 38 |
| `@parasol/eval` | 42 |
| `@parasol/web` | 96 (+10) |
| `@parasol/corpus` | 63 |
| `@parasol/ai` | 95 |

## Verification evidence

```
pnpm turbo typecheck test lint --force
→ 18/18 successful, 400 tests passing
→ Zero TS errors, zero lint warnings
```

## Schema relaxation: SupabaseClient generic

`packages/core/src/repositories/types.ts` widens the `SupabaseClient` re-export from `SupabaseClient<Database>` (2-param) to `SupabaseClient<Database, any, any>` (loose) so the SSR client from `@supabase/ssr` (which surfaces a 5-param generic with a resolved schema literal) can be passed to repositories without a cast. Both clients have the same runtime surface; the looser generic just stops TypeScript from rejecting one when the other is expected.

This change touched `process-review.ts` and `pipeline-events.ts` to import `SupabaseClient` from `@parasol/core` instead of `@supabase/supabase-js`.

## What is NOT done

- **Real Supabase Auth sign-in flow** — `/login` is a stub. Sprint 2 wires email magic link + OAuth (Microsoft, Google) per CLAUDE.md's auth section.
- **Server-Sent Events / RSC streaming progress** — DEF-049 (new). The 5-second meta-refresh polling is the Sprint 1 floor; it's annoying but functional.
- **Supabase Storage migration for redline bytes** — DEF-048 (new). Inline base64 works for Sprint 1 NDAs; bigger contracts in v2 would need this.
- **Audit log entries for upload + review events** — the per-stage audit-log writes are pending. Day 12 has slack to add `review.created` / `review.completed` rows; if not, post-launch hardening picks it up.
- **Live forward test on a real NDA via the web upload** — needs deployment. Day 13 smoke test will exercise this.
- **Multi-attachment uploads** — single-file Sprint 1; cover-sheet + contract bundles are deferred.

## Known issues / technical notes

- **Polling vs streaming**: the meta-refresh approach reloads the whole page every 5 seconds. In a live deployment this triggers a fresh server round-trip + RLS check per refresh, which is fine for the dev volume but should be replaced before public launch (DEF-049).
- **`extracted_clause_id` is null on issues**: the orchestrator's `PipelineIssue.clauseId` is a string clause id, not the inserted row's UUID. Linking issues to clauses by FK would require a second pass (insert clauses, build a `clauseId → uuid` map, then insert issues). Sprint 1 leaves the FK null and joins on the string `clause_id` for the review page. The schema-level FK column is preserved for v2.
- **`source_url` is null on inserted citations**: `PipelineCitation` doesn't carry a URL today. The verify-citations step resolves canonical IDs to corpus rows but doesn't propagate the source URL through to the issue model. Day 12 polish or DEF-049-adjacent work can backfill from `corpus_documents.source_url`.
- **`inline` bytes path doesn't fail-soft on overlarge files post-upload**: the multipart handler enforces 10 MB at upload time; once `processReview` is on the after-response side, an in-memory copy of the bytes lives until extract-pages finishes. Vercel function memory caps (1 GB on Pro) are far above this; just noting the model.
- **Top of `/review/[id]` shows "Completed" banner even on zero-issue reviews**: that's intentional — a clean contract is a successful review, not nothing. Issue list shows "No issues identified against the playbook."

## Database state

Migration 0007 added: `reviews.redline_docx_base64`, `reviews.web_view_json`, `reviews.email_body_json`. `db.ts` updated with the new columns + the existing `extracted_clauses`, `issues`, `citations` table types (these were always in 0003 but hadn't been declared in `db.ts` because no app code touched them until today).

Tim — when convenient, run `pnpm db:migrate` to apply 0007 to the dev project. The web upload flow will fail on the `updateAssembled` step until it lands.

## Exact next step (Day 12) — Corpus admin UI complete

Day 12 plan from `docs/sprint-1-plan.md`:
1. **`apps/web/src/app/admin/corpus/page.tsx`** — replace the Day 1 stub with the real implementation: health summary card, sources list with per-source status / last_run_at / document_count, recent runs panel, "Run now" button per source.
2. **`apps/web/src/app/api/admin/corpus/sources/route.ts`** — GET sources list (currently a stub returning [])
3. **`apps/web/src/app/api/admin/corpus/runs/route.ts`** — GET recent runs
4. **`apps/web/src/app/api/admin/corpus/sources/[id]/run/route.ts`** — POST triggers `runIngestion()` from `@parasol/corpus`
5. All admin actions write `audit_log` entries namespaced `admin.corpus.*`
6. UI matches the parasol_corpus_admin design from chat artefacts (2026-05-03)

## Tim action items

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): not blocking Sprint 1.
- **`pnpm db:migrate`** to apply migration 0007 to the dev project — required before the web upload flow can complete a review end-to-end. Email path continues to work without it (the persist step would fail on the assembled-update column write but the reply send is independent).
