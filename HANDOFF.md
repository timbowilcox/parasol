# Handoff: Sprint 1, Day 8 — Heavy reasoning stages + citation validation

Date: 2026-05-04
Session type: Sprint 1 Day 8

## What was completed

Day 8 scope per `docs/sprint-1-plan.md`: the heavy Sonnet reasoning stages (compare-playbook, generate-redline) plus the deterministic citation validator and confidence calibration. Orchestrator now runs stages 1-8 end to end. Stages 9 (defined-terms-check) and 10 (assemble-output) land Day 9.

### Stage I/O extensions (`packages/ai/src/stages/types.ts`)

New schemas added on top of Day 7's:
- **`PlaybookDeviation`** — output of compare-playbook. `playbookClauseId` matches a clause in the playbook YAML; `matchedExtractedClauseId` matches one of stage-4's extracted clauses (empty when the clause is missing entirely from the document); `position` ∈ `{standard, fallback, hard_limit, violation}`; `severity`; `confidence`; **verbatim** `currentText` (required for downstream hallucination detection); `reasoning`.
- **`PipelineIssue`** — output of generate-redline. Includes `clauseId`, severity, confidence, `currentPosition`, `recommendedPosition`, `reasoning`, `redlineText` (verbatim substitution; empty when clause is missing-entirely), and `citations[]` with `source` (10-value enum mirroring playbook), `id`, optional `section`, `validated` flag (false from generate-redline; verify-citations promotes to true after deterministic resolution).

### Citation validator (`packages/ai/src/citation-validator.ts`)

Pure async function `validateCitations(issues, { resolveCitation })` that:
1. Skips resolution for non-corpus sources (`market-norm`, `parasol-internal`) — these are intentionally trusted.
2. For corpus-backed sources, calls the supplied `CitationResolver` to verify the canonical id resolves in `corpus_documents`.
3. Treats resolver throws as unresolved (conservative-safe).
4. Falls back to the model-supplied `validated` flag when no resolver is wired (unit-test path; CI gate always supplies one).
5. Applies confidence calibration on any unresolved corpus citation within an issue:
   - `high → medium`
   - `medium → manual_review_recommended`
   - `manual_review_recommended → unchanged` (already at floor)
6. Returns the validated issues + diagnostic counts.

The validator is the deterministic enforcement of CLAUDE.md's hard requirement: *"Anything claiming 'DPA 2019 s.40' must resolve in the corpus or the redline regenerates."* A separate Sonnet content-claim pass (does the citation's text actually support the claim?) is deferred to Day 13 polish if eval shows the deterministic-only check is insufficient.

### Compare-playbook prompt + stage

- Sonnet 4.7 (Sprint 2 A/B-tests Opus per DEF-041).
- Receives the playbook via the cached system prefix (orchestrator passes `includePlaybookContext: true`). Anthropic's prompt cache holds the playbook for ~5min — every subsequent stage call within the same review pays only for the user-message delta.
- For each extracted clause: matches it to a playbook clause id, decides where it falls on the standard/fallback/hard_limit/violation spectrum, emits a deviation entry only when there's something to flag.
- Severity rules baked into the system prompt: `critical` for hard-limit breaches and missing critical clauses; `material` for fallback positions; `minor` for cosmetic gaps.
- Special case: when the playbook has a clause the document is missing entirely, emits a deviation with `matchedExtractedClauseId: ""` and `position: "violation"`.

### Generate-redline prompt + stage

- Sonnet 4.7. **Per-deviation** (one call per flagged clause). Per orchestration.md, this is the architectural choice — keeps each call's cached prefix focused and lets the orchestrator gracefully degrade when one redline fails.
- Cached system prefix carries: system prompt + playbook + per-clause authority chunks (the orchestrator updates `ctx.authorityChunks` between calls).
- Output is a full `PipelineIssue` ready for the audit log + UI: `currentPosition` and `recommendedPosition` summaries, `reasoning` paragraph, exact `redlineText` substitution, and structured citations.
- Critical instruction in the system prompt: **"Cite or don't claim."** If the model can't cite a Kenyan or EAC authority, it must use a `market-norm` citation explicitly — fabricating a statute reference is a hard failure mode.

### Playbook serialiser (`packages/playbooks/src/serialise.ts`)

`serialisePlaybookForContext(playbook): string` renders a `Playbook` into a markdown string suitable for the cached system prefix:
- Document header with status banner (draft playbooks get an explicit warning the model sees, so confidence calibration can downgrade clauses where the playbook is the only authority).
- Per-clause section with all three positions + rationale + citations.
- Aliases line included only when the clause defines them.

This is the bridge between `@parasol/playbooks` and `@parasol/ai`. The orchestrator deliberately does not depend on `@parasol/playbooks` — the caller (route handler / eval runner) loads the playbook and passes the serialised string via `OrchestratorInput.playbookContext`.

### Orchestrator extension (`packages/ai/src/orchestrator.ts`)

Stages 5-8 wired:
- **Stage 5: compare-playbook** — runs once per review, produces a list of `PlaybookDeviation`s.
- **Stage 6: retrieve-authority** — deterministic, per-deviation. Calls the caller-supplied `AuthorityRetriever` (wraps `@parasol/corpus.retrieveAuthority`). Builds the query as `${clauseId} ${reasoning}` (clipped to 240 chars). `topK: 8` per call to keep prompt sizes manageable.
- **Stage 7: generate-redline** — Sonnet, per-deviation. The orchestrator updates `ctx.authorityChunks` for each deviation before the call, so each generate-redline invocation sees only the authority for its own clause. Per-deviation try/catch: a single redline failure produces a manual-review placeholder issue and the rest of the pipeline continues (per orchestration.md "The orchestrator collects partial successes").
- **Stage 8: verify-citations** — runs `validateCitations()` over the full issue list, mutates `validated` flags + confidences, returns the validation outcome alongside the issues.

New `OrchestratorInput` fields:
- `playbookContext?: string | null` — pre-serialised playbook text. Null skips stages 5-8.
- `retrieveAuthority?: AuthorityRetriever | null` — null skips retrieval; generate-redline runs without authority context.
- `resolveCitation?: CitationResolver | null` — null skips deterministic citation verification.

`OrchestratorRunResult` now includes:
- `deviations?: PlaybookDeviation[]` — stage-5 output
- `issues: PipelineIssue[]` — stage-7 + stage-8 output (production type, replaces Day-7's stub)
- `citations: PipelineCitation[]` — flattened from issues for the eval harness
- `citationValidation?: ValidationOutcome` — diagnostic counts from stage 8

### Tests added (42 new)

| Suite | Tests |
|-------|-------|
| `packages/ai/src/citation-validator.test.ts` | 17 — `degradeConfidence` (3 cases), `countTrustedCitations` (3), resolver path with mixed sources, non-corpus skip, throw-as-unresolved, no-resolver fallback, confidence calibration (high→medium, medium→manual_review, unchanged when all resolve, unchanged for non-corpus-only), edge cases, vocabulary integrity |
| `packages/ai/src/stages/compare-playbook.test.ts` | 6 — model-output parsing, completed-event captures cache-read tokens, structured-system block (cached playbook context attached), input schema rejects empty clauses, output schema accepts empty deviations, output schema rejects unknown position |
| `packages/ai/src/stages/generate-redline.test.ts` | 6 — structured-issue parsing, both playbook + authority blocks attached as cached, authority block omitted when empty, schema rejects missing redlineText, schema accepts empty redlineText, schema rejects invalid citation source enum |
| `packages/ai/src/orchestrator.test.ts` (extension) | 5 — full stage 1-8 pipeline (DPA s.49 path), stage-4-only when no playbookContext, citation-failure → confidence downgrade, generate-redline failure → manual-review placeholder + pipeline continues, run-without-retrieval-or-resolver |
| `packages/playbooks/src/serialise.test.ts` | 8 — header content, draft-status warning, production no warning, three-position layout, citations rendered, citations omitted when empty, aliases included, aliases omitted when empty |

Cumulative repo test count: **332 passing across 6 packages** (+42 today).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18/18 successful, 332 tests passing
→ Zero TS errors, zero lint warnings
```

## Database state

Unchanged. No migrations today.

## What is NOT done

- **Stage 9: defined-terms-check** — Day 9.
- **Stage 10: assemble-output** (DOCX tracked-change generation, email body, web view JSON) — Day 9.
- **Document intake plumbing** (PDF byte-extraction, DOCX-to-text, page rasterisation for vision) — Day 9-10.
- **Production end-to-end run on a real NDA** — Day 13 reflows.
- **Eval gate flipped to `--pipeline=production`** — possible after Day 9 ships assemble-output.
- **Sonnet content-claim citation validator** — the deterministic resolution check is the hard requirement and is in place. Day 13 polish if eval reveals false negatives.

## Known issues / technical notes

- **Workspace dependency boundary preserved**: `@parasol/ai` still does not depend on `@parasol/corpus` or `@parasol/playbooks`. The retrieve-authority and resolveCitation functions are dependency-injected by the caller; the playbook arrives pre-serialised as a string. This keeps the workspace cycle closed.
- **Generate-redline cost**: per orchestration.md, ~$0.15 per NDA on Sonnet baseline. Sprint 1 within the $0.20-per-review budget.
- **Cache hit rate**: every generate-redline call within a review reuses the same cached playbook prefix. Authority chunks are clause-specific, so they cache-miss per clause but hit on retry. Day 13 eval will surface aggregate cache savings.

## Exact next step (Day 9) — Final stages + end-to-end smoke test

Day 9 plan from `docs/sprint-1-plan.md`:
1. **`packages/ai/src/prompts/defined-terms-check.ts` + stage** — Haiku. Cross-references defined terms across the document. Best-effort; failures non-blocking.
2. **`packages/ai/src/stages/assemble-output.ts`** — deterministic. Generates `.docx` tracked changes via docxtemplater, plain-text email body, web view JSON.
3. **Orchestrator fully wired** — stages 9 + 10 in.
4. **End-to-end integration test** — submit one real NDA → receives `issues[]` + `review_documents` (redlined .docx).
5. **p95 latency measured on 3 test NDAs; confirm < 60s.**
6. **All `pipeline_events` written to DB; audit_log entry on review completion.**

Day 9 has no Tim action items.

## Tim action items still open

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): not blocking Sprint 1.
