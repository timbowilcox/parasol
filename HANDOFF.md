# Handoff: Sprint 1, Day 9 — Final stages + orchestrator complete

Date: 2026-05-04
Session type: Sprint 1 Day 9

## What was completed

Day 9 scope per `docs/sprint-1-plan.md`: stage 9 (defined-terms-check, Haiku), stage 10 (assemble-output, deterministic). Orchestrator now runs all 10 stages end-to-end. PipelineEventRepository added to `@parasol/core` so route handlers can persist stage transitions to the `pipeline_events` table created in migration 0003.

### Stage I/O extensions (`packages/ai/src/stages/types.ts`)

- **`DefinedTermIssue`** — output of defined-terms-check. `term`, `kind: undefined_use | unused_definition | inconsistent_use`, `description`, optional `sectionReference`.
- **`WebViewData`** — JSON for the `/review/[id]` React page. `reviewId`, contract metadata, `summary` (severity counts + citationValidityRate), `issues[]`, `definedTerms[]`.
- **`EmailBody`** — `subjectSuffix`, `plainText`, `html` (escaped + structured). Goes into the Resend reply.
- **`AssembledOutput`** — `webView`, `email`, `redlineDocxBase64`. The route handler reads each.

### Defined-terms-check prompt + stage (`packages/ai/src/prompts/defined-terms-check.ts`, `stages/defined-terms-check.ts`)

- Haiku 4.5 (cheap pattern-matching, not playbook-aware).
- Identifies three classes of issue: `undefined_use`, `unused_definition`, `inconsistent_use`. System prompt instructs the model to be conservative on common NDA terms (Disclosing/Receiving Party are conventional).
- Best-effort: per orchestration.md the orchestrator wraps this in a try/catch that swallows failures (returns `definedTerms: []` instead of erroring). The proofreader can't break the review.

### Assemble-output (`packages/ai/src/assemble-output.ts`)

Deterministic — no LLM call. Produces three customer-facing surfaces:

1. **Web view JSON** — `WebViewData` for the React review page. Counts issues by severity, computes `citationValidityRate` over the union of issue citations (non-corpus sources count as trusted; corpus-source citations count only when `validated=true`).
2. **Email body** — plain-text + HTML. Subject suffix includes severity counts. Body lists each issue with current/recommended/reasoning/citations. Unresolved citations get `[unverified]` markers. HTML escapes user-visible strings to prevent injection (`<script>` in `currentPosition` becomes `&lt;script&gt;`).
3. **Redline DOCX** — base64-encoded Word document. Format: header (contract type, jurisdiction, parties), summary table (severity counts), per-issue detail (current/recommended/reasoning/citations/proposed-redline), defined-term issues, and the original document body annotated with `[REDLINE — clauseId: recommendation]` markers next to flagged paragraphs.
   
   Sprint 1 deliberately does NOT use Word's native tracked-changes feature (InsertedTextRun / DeletedTextRun + `Document.features.trackRevisions`). Native tracked-changes requires preserving the original DOCX's paragraph structure to anchor revision marks correctly — a real engineering task beyond Day 9 scope. **DEF-046** tracks the upgrade for Day 12 polish or post-launch.

### Pipeline-events repository (`packages/core/src/repositories/pipeline-events.ts`)

- `PipelineEventRepository.append(...)` writes one row per stage transition to the `pipeline_events` table (created in migration 0003).
- `PipelineEventRepository.listForReview(reviewId)` reads chronological history for a review — used by the Sprint 5+ admin observability dashboard and Day-13 latency analysis.
- The orchestrator emits `PipelineEvent`s via `OrchestratorContext.emitEvent`; the route handler binds these to the repository (`apps/web/src/server/pipeline-events.ts` lands Day 10).

### Orchestrator extension (`packages/ai/src/orchestrator.ts`)

Stages 9 + 10 wired:

- **Stage 9: defined-terms-check** — runs sequentially after the redline loop. Per orchestration.md the canonical design has stage 9 in parallel with stages 5-7; Sprint 1 ships sequential because (a) it makes deterministic mock-based tests possible, (b) the latency cost (one extra Haiku call, ~1-3s) is well within the 60s p95 target. Day 13 latency analysis can decide whether to re-introduce `Promise.all`.
- **Stage 10: assemble-output** — deterministic; runs after verify-citations. Awaits all upstream output. Wrapped in try/catch with explicit `started`/`completed`/`failed` event emission so the route handler sees a real exception if assemble-output fails (a real bug, not a degradable failure).

`OrchestratorRunResult` now includes:
- `definedTerms?: DefinedTermIssue[]` — empty array on stage-9 failure
- `assembled?: AssembledOutput` — present on every successful production run

### Schema relaxation: `comparePlaybookInputSchema.clauses`

Changed from `min(1)` to unconstrained. The orchestrator can now call compare-playbook on documents where extract-clauses returned no structured clauses; the model returns empty deviations and the pipeline continues to stages 9 + 10. This avoids the orchestrator throwing on edge-case inputs like NDA cover-pages with no extractable structure.

## Tests added (29 new)

| Suite | Tests |
|-------|-------|
| `packages/ai/src/stages/defined-terms-check.test.ts` | 5 — model-output parsing, empty-input rejection, schema accepts empty issues, schema rejects unknown kind, schema requires non-empty term |
| `packages/ai/src/assemble-output.test.ts` | 11 — web view (reviewId/contract type/parties/summary, citationValidityRate semantics including non-corpus trusted, severity-count aggregation, definedTerms inclusion), email body (subject suffix, plain text content, unverified markers, citation-validity-note conditional, HTML escaping + structure), DOCX (valid base64 zip, empty-issue path) |
| `packages/core/src/repositories/pipeline-events.test.ts` | 9 — append (full/defaults/nulls/error), listForReview (order, empty, error). Tests the repository in isolation with mocked Supabase clients |
| `packages/ai/src/orchestrator.test.ts` (extension) | 4 — full 1-10 pipeline with assembled output, assemble-output PipelineEvent emission, defined-terms-check failure swallowed (graceful), schema-relaxation regression coverage |

Cumulative repo test count: **361 passing across 6 packages** (+29 today).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18/18 successful, 361 tests passing
→ Zero TS errors, zero lint warnings
```

## Database state

Unchanged. `pipeline_events` table was created back in migration 0003 (Day 1); Day 9 only adds the repository wrapper.

## What is NOT done

- **Live end-to-end smoke test on a real NDA** — needs the route handler to call the orchestrator end-to-end. That's Day 10 (email intake completion) + Day 11 (web upload UI). Day 13 reflows.
- **Native Word tracked-changes for the redline DOCX** — DEF-046. The current DOCX has visible `[REDLINE — ...]` markers but doesn't use Word's native Insertion/Deletion + Accept/Reject flow.
- **Pipeline-events route-handler wire-up** — `apps/web/src/server/pipeline-events.ts` (the helper that returns an `emitEvent` function bound to the repository) lands Day 10.
- **`pnpm pipeline:smoke` CLI** — useful for manual end-to-end testing without spinning up the full Next.js dev server. Not on the Sprint 1 critical path; defer to Day 13 polish if needed.
- **`p95 latency measured on 3 test NDAs`** — needs live API calls + intake plumbing. Day 10/11 will produce these measurements.

## Known issues / technical notes

- **Sequential vs parallel stages 5+9**: orchestration.md describes stage 9 (defined-terms-check) running in parallel with stages 5-7. Sprint 1 ships sequential — the latency cost is small (~1-3s extra Haiku call) and the simplification makes deterministic testing possible. Day 13 latency analysis can promote to `Promise.all` if needed.
- **Severity color hex format**: The `docx` library rejects `#` prefixes and 3-character short forms. `severityColor()` in assemble-output.ts returns 6-character lowercase hex without `#`; HTML callers prepend `#` at the call site.
- **DOCX redline annotations are heuristic**: the inline `[REDLINE — ...]` markers use a 32-character substring match against extracted paragraph text to identify which paragraphs to annotate. This works on clean digital PDFs and DOCX inputs but may miss matches on heavily reflowed inputs. Native tracked-changes (DEF-046) sidesteps this entirely.

## Exact next step (Day 10) — Email intake completion

Day 10 plan from `docs/sprint-1-plan.md`:
1. **Email route handler wired fully to orchestrator pipeline** — `apps/web/src/app/api/inbound/email/route.ts` calls `runOrchestrator` and processes the result.
2. **Reply assembly: Resend outbound with redlined .docx attachment + structured summary body** — uses `assembled.email.subjectSuffix`, `assembled.email.html`, attaches the base64 DOCX.
3. **Sender domain allowlist enforcement** — already in place; this day verifies it.
4. **Webhook signature verification integration test** (Svix replay-attack prevention) — already in place; this day exercises against a Resend test fixture.
5. **`pnpm test` passes including email integration tests** against Resend test fixture.
6. **End-to-end: forward a real NDA to `test@ask.parasol.co.ke`; receive reply within 90s**.

Day 10 has no Tim action items beyond the Resend MX which Tim already verified Day 5.

## Tim action items still open

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): not blocking Sprint 1.
