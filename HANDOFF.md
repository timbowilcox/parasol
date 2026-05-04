# Handoff: Sprint 1, Day 10 — Email intake completion

Date: 2026-05-04
Session type: Sprint 1 Day 10

## What was completed

Day 10 closes the email intake loop: the inbound webhook now hands off to the orchestrator end-to-end, and the customer receives a Resend reply with the redlined DOCX + structured summary. Five new modules; route handler upgraded with Vercel `after()` for post-response work; 23 new tests.

### Document intake (`apps/web/src/lib/intake/extract-pages.ts`)

`extractPages({ bytes, mimeType, filename? })` returns `{ ok: true; pages: PageInput[]; rawCharCount }` or a typed failure (`unsupported_mime` | `extraction_failed` | `empty_document`).

- **PDF** via `pdf-parse/lib/pdf-parse.js` (deep import skips the package's debug harness in `index.js`). Splits the document text on `\f` so each page becomes a `PageInput` for quality-assess to score independently.
- **DOCX** via `mammoth.extractRawText`. Word stores reflow not pages, so the result is a single `PageInput` with concatenated text.
- **text/plain** passthrough — single `PageInput`.
- **MIME normalisation** trusts the filename extension when the upstream sender uses `application/octet-stream`. Legacy `.doc` (application/msword) is rejected with `unsupported_mime`.
- Empty PDF text on a multi-page document is a scan masquerading as digital — surfaced as `empty_document` with an explanatory detail. Rasterised vision intake is deferred (DEF-047 — new this session).

### Resend outbound (`apps/web/src/lib/email/resend-send.ts`)

Two thin `fetch` wrappers — no SDK dep:

- `sendReply({ to, inReplyTo?, subject, text, html, attachments? })` POSTs to `https://api.resend.com/emails` with the workspace `from` (`PARASOL_OUTBOUND_FROM` env). Threads via `In-Reply-To` + `References` headers when `inReplyTo` is supplied. Attachments forwarded as `{ filename, content: contentBase64 }` per Resend's API.
- `fetchInboundAttachment({ emailId, attachmentId })` GETs `/emails/{email_id}/attachments/{attachment_id}` and returns the raw bytes + Content-Type.

Both return discriminated unions (`{ ok: true; ... } | { ok: false; status; detail }`) so callers branch on `result.ok` rather than try/catch.

### Pipeline-events binder (`apps/web/src/server/pipeline-events.ts`)

`bindEventsToReview({ supabase, reviewId, onPersistError? })` returns the `(event: PipelineEvent) => void` callback the orchestrator expects. Internally:

- Wraps a `PipelineEventRepository.append(...)` call per event.
- Fire-and-forget — errors surface to `onPersistError` (defaults to `console.error`). An observability write failing must not abort the actual review.

### Process-review orchestration helper (`apps/web/src/server/process-review.ts`)

The single entry point for "I have a `pending` review and an attachment, run the pipeline and reply." Used by Day 10's email path; Day 11's web upload path will call into the same helper.

Flow:

1. Move review → `processing`
2. Fetch attachment bytes via `fetchInboundAttachment`
3. Extract pages via `extractPages` → on failure, route to `unsupported` branch
4. Load + serialise the kenya/nda playbook (Sprint 1 always uses this; once we ship more playbooks, selection happens after triage)
5. Build dependency-injected helpers — `AuthorityRetriever` wraps `@parasol/corpus.retrieveAuthority`, `CitationResolver` calls `CorpusRepository.findLatestDocument` with a citation-source → corpus-source-type mapping
6. Run the orchestrator
7. On `unsupported` (extraction failure or out-of-scope contract type) — send an explainer reply, no DOCX attachment
8. On success — send the reply with `assembled.email.html`, `assembled.email.plainText`, and `assembled.redlineDocxBase64` as a Word attachment named `{originalFilename}-redlined.docx`
9. Move review → `completed` / `unsupported` / `failed`

Subject line: prefixes `Re:` (without double-prefixing if the inbound was already `Re:`) and appends `assembled.email.subjectSuffix`.

Persistence of issues/citations/clauses to the relational tables is deliberately Day 11 (web review page); Day 10 only updates the review row and surfaces results via the email reply.

### Inbound route upgrade (`apps/web/src/app/api/inbound/email/route.ts`)

After the synchronous Day 5 path (verify Svix → classify → allowlist → insert review row) returns `200`, `next/server.after()` runs `processReview(...)` post-response. `export const maxDuration = 120` keeps the Vercel function alive long enough for the heavy stages; Day 13 latency analysis will likely tighten this back to 60 once we have measurements.

`after()` is the Vercel-recommended pattern for "respond to webhook fast, do the work after". A real queue (Inngest / Supabase cron) is DEF-018 and lands when we either self-host or hit Vercel's per-function limits.

## Tests added (23 new — apps/web went 63 → 86)

| Suite | Tests |
|-------|-------|
| `apps/web/src/lib/intake/extract-pages.test.ts` | 8 — text/plain happy path + whitespace-empty rejection, MIME normalisation (octet-stream + .pdf, legacy .doc reject, unknown MIME), DOCX (mammoth happy path, whitespace-only, error path), PDF (form-feed splitting, empty-document path) |
| `apps/web/src/lib/email/resend-send.test.ts` | 5 — sendReply (body shape + threading headers + attachments + Authorization, non-2xx failure, missing API key), fetchInboundAttachment (URL + auth, 404 path) |
| `apps/web/src/server/pipeline-events.test.ts` | 3 — happy-path persistence, error forwarding to onPersistError, null-default normalisation |
| `apps/web/src/server/process-review.test.ts` | 7 — happy path with reply send, two unsupported branches (extraction failure + triage rejection), three failed branches (attachment fetch / no-attachment / orchestrator throw), subject double-prefix prevention |

Cumulative repo test count: **384 passing across 6 packages** (+23 today).

| Package | Tests |
|---------|-------|
| `@parasol/core` | 60 |
| `@parasol/playbooks` | 38 |
| `@parasol/eval` | 42 |
| `@parasol/web` | 86 (+23) |
| `@parasol/corpus` | 63 |
| `@parasol/ai` | 95 |

## Verification evidence

```
pnpm turbo typecheck test lint --force
→ 18/18 successful, 384 tests passing
→ Zero TS errors, zero lint warnings
```

## What is NOT done

- **Live forward test on a real NDA** — the inbound webhook has only ever received synthetic test fixtures; the real test happens at deployment time when Tim forwards an NDA to `*@ask.parasol.co.ke`. No code change required, but the smoke is on the deployment runbook (Day 13).
- **Vision-degraded intake** — DEF-047 (new). Scans + photographs land in the `empty_document` branch and get the explainer reply.
- **Issues / citations persistence to the relational tables** — Day 11 (web review page) wires the inserts. Day 10 ships the email reply only; the review row holds intake metadata + status + error_message.
- **`pnpm pipeline:smoke` CLI** — was deferred from Day 9; still not on the critical path.
- **`p95 latency measured on 3 test NDAs`** — needs the live forward test above.

## Known issues / technical notes

- **`maxDuration = 120` is provisional**: Vercel's hobby tier caps at 60s; Pro caps at 300s. Sprint 1 target is 60s p95 — Day 13's measurement decides whether 60 is safe or whether we need Pro / chunked processing. Tim's deployment plan has us on Pro from launch, so 120 is fine for now.
- **Attachment loop only processes `data.attachments[0]`**: real customer emails sometimes include cover-sheet PDFs alongside the contract. Picking the first attachment matches Sprint 1 simplicity; Day 11 (web upload) handles multi-attachment selection explicitly. If a real test surfaces this as a friction point, escalate to a new DEF.
- **No retry on Resend reply send failure**: if Resend returns 5xx, the review status moves to `failed` and the customer doesn't receive a reply. Operationally, a re-trigger from the admin UI (DEF-038) is the answer; sketching that in Day 11+ is fine.
- **Subject formatting heuristic**: `originalSubject.toLowerCase().startsWith('re:')` catches the common case; "RE:" / "Re :" / threaded-prefix replies (e.g., "Aw:" in German) fall through. The mis-formatted subject is cosmetic — the customer still gets the right reply.
- **Pipeline event persistence is best-effort**: the orchestrator's `emitEvent` is sync; we await nothing. If the workspace's Supabase write fails the orchestrator still finishes and the customer still gets their reply — observability data lost in that one row only. This is intentional per `bindEventsToReview`'s docstring.

## Database state

Unchanged. Day 10 only adds application code on top of the schema landed in migrations 0003 + 0004.

## Exact next step (Day 11) — Web upload UI + review page

Day 11 plan from `docs/sprint-1-plan.md`:
1. **Web upload page at `/upload`** — drag/drop + file picker; calls a new `/api/upload` route handler that uploads to Supabase Storage, inserts a `review` row, then runs `processReview` (same helper as Day 10) via `after()`.
2. **Review page at `/review/[id]`** — server component that loads the review + assembled web view JSON; renders the issue list, citation badges (validated / unverified), and a download link for the redlined DOCX.
3. **Issues / citations / extracted-clauses persistence** — Day 11 adds repositories + writes from `processReview` so the web review page has data to render.
4. **Auth gate** — pages require workspace membership; the route handler enforces RLS via the user's session.
5. **`pnpm test` includes the upload flow tests + the review page rendering tests.**

## Tim action items still open

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): not blocking Sprint 1.
