# Handoff: Sprint 1, Day 6 — Eval harness

Date: 2026-05-04
Session type: Sprint 1 Day 6

## What was completed

Day 6 scope per `docs/sprint-1-plan.md`: eval harness skeleton — runner, metrics, reporter, ground-truth annotation YAML schema, 5 annotated NDAs, CI gate. Plus DEFERRED hygiene (DEF-001, DEF-005, DEF-008 moved to Completed now that Tim has resolved them).

### `packages/eval/src/` (was a stub package)

- **`types.ts`** — single source of truth for the eval data model. Key types: `GroundTruth` (per-NDA annotation), `ExpectedIssue`, `ExpectedCitation`, `PipelineOutput`, `PerNdaScore`, `EvalRunResult`, `AggregateScore`. Plus `SPRINT_1_ACCEPTANCE_BAR` constant declaring F1 ≥ 0.85, citation validity = 1.0, hallucination ≤ 0.02, redline appropriateness ≥ 0.80 — matches the Sprint 1 acceptance criteria in `docs/sprint-1-plan.md` exactly.
- **`schema.ts`** — Zod schema for the annotation YAML. Validates `filename`, `annotated_at` (YYYY-MM-DD), `annotated_by`, optional `notes`, `expected_issues[]` (clause_id, severity, description, optional required + expected_confidence), optional `expected_citations[]`. Citation source enum mirrors the playbook's.
- **`metrics.ts`** — pure scoring functions:
  - `scoreNda({ groundTruth, pipelineOutput, sourceText, resolveCitation })` returns a `PerNdaScore` with precision / recall / F1 (matched on `clause_id::severity`), citation validity rate, hallucination rate, and per-NDA diagnostics (matched / extra / missed issues + invalid citations).
  - `aggregate(perNda[])` computes mean across cases. Redline appropriateness is only included for the rated subset (sampled at 20% per the sprint plan).
  - `checkAcceptanceBar(aggregate, bar)` returns pass/fail + structured failure reasons. Used by the CI gate.
  - Severity matching is **strict** (mismatch counts as miss + extra). Day 13 may revisit if the eval data shows the model commonly swaps neighbouring severities.
  - Hallucination check is conservative: any `current_position` ≥ 12 chars whose normalised text doesn't appear as a substring of the source. Skipped when `sourceText` is null (e.g. PDF / DOCX before extraction lands Day 7).
- **`pipeline-stub.ts`** — `runStubPipeline(gt, { mode })` produces deterministic output for `oracle` (echoes ground truth perfectly → F1 = 1.0) or `noisy` (drops a critical, swaps a severity, hallucinates an issue, marks one citation invalid → F1 < 1, hallucination > 0). Lets us exercise the harness end-to-end before the real orchestrator lands Day 9.
- **`runner.ts`** — `loadAnnotations(dir)` walks the golden directory for `*.annotation.yaml` files, parses + validates each, and pairs with the corresponding NDA file. Skips plaintext load for binary formats (`.pdf`, `.docx`, `.doc`) so reading garbage UTF-8 doesn't poison the hallucination check; Day 7's extract-text stage will be wired in later. `run({ pipeline, ... })` runs the pipeline against each annotation, scores, returns the full `EvalRunResult`.
- **`reporter.ts`** — `writeJson(result, dir)` writes `<sprint>.json`; `formatSummary(result)` returns the human-readable table (per-NDA + aggregate + acceptance verdict + diagnostics).
- **`cli/run.ts`** — `pnpm --filter @parasol/eval run eval`. Flags: `--pipeline=<stub-oracle|stub-noisy|production>`, `--sprint=<label>`, `--no-corpus`, `--golden-dir=<path>`. Wires Supabase corpus resolver when env present. Production-pipeline flag deliberately throws until Day 9 lands the orchestrator (avoids silent-stub-mode-passing-CI gotcha).
- **`cli/gate.ts`** — `pnpm --filter @parasol/eval run eval:gate`. Reads the result JSON and exits 1 with structured failure reasons if the aggregate breaches the acceptance bar.
- **`index.ts`** — barrel export.

### Annotations

Five NDAs annotated in `packages/eval/data/golden/nda/<filename>.annotation.yaml`:
- **nda-001.pdf** — Calpine Corp / LS Power M&A NDA (US, mutual, signed). Heavy critical-flag profile (Delaware governing law, Delaware courts, no DPA-aware language). 5 issues + 4 expected citations.
- **nda-009.pdf** — Common Paper Mutual NDA (US-Delaware default, template). Cover-page-only edge case. 3 critical issues + 2 citations.
- **nda-010.pdf** — gov.uk mutual NDA (UK template). Cleaner alignment with playbook (English law within fallback) — 3 material/minor issues + 2 citations.
- **nda-013.pdf** — Britam Kenya supplier NDA (Kenya, one-way). Most representative of ICP. 4 issues spanning critical/material/minor + 3 citations.
- **nda-015.docx** — Common Paper DOCX form (mirror of nda-009.pdf). Exercises the DOCX code path. 4 issues + 3 citations.

All annotations are `annotated_by: parasol-internal-draft` — the same draft-status mechanic as the playbook (DEF-028 path). Counsel review of annotations is a v1-launch gate; absolute scores from the production pipeline land Day 13. Until then, the harness verifies relative correctness (regression detection), not absolute benchmarks.

`packages/eval/data/golden/nda/README.md` documents the annotation format.

### CI gate (`.github/workflows/ci.yml`)

The previous `eval-gate` job was gated behind `vars.EVAL_GATE_ENABLED` and required all the API + Supabase secrets. Replaced with a Sprint-1-appropriate version that:
1. Runs `pnpm eval -- --pipeline=stub-oracle --no-corpus` (no secrets needed)
2. Runs `pnpm eval:gate` against the resulting JSON

Verifies the harness wiring (schema, runner, metrics, reporter, gate) is intact end to end. Day 9 flips to `--pipeline=production` with secrets once the orchestrator lands.

Also added a `playbook-validate` job that runs the playbook validator with `--no-corpus` (schema-only, since Supabase is not exposed in CI).

### Tests added (42 new)

| Suite | Tests |
|-------|-------|
| `packages/eval/src/schema.test.ts` | 7 — minimal valid, required-field rejection, malformed date, unknown severity, optional fields, unknown citation source, multi-citation |
| `packages/eval/src/metrics.test.ts` | 22 — `normaliseForSubstringMatch`, perfect match, false-negative penalty, false-positive penalty, severity strict mismatch, citation validity (no-resolver / resolver / fallback to validated flag / dedup), hallucination (zero / 1.0 / null source / short text), aggregate (empty / averaging / rated subset), acceptance bar (pass / F1 fail / hallucination fail / citation fail / redline only when present), buildRunResult |
| `packages/eval/src/runner.test.ts` | 6 — annotation loading, oracle yields F1=1 across cases, noisy degrades, malformed annotation throws, progress callback fires, binary-format `.pdf` source skip |
| `packages/eval/src/reporter.test.ts` | 7 — JSON write, default results dir constant, per-NDA filenames in table, acceptance verdict (PASS + FAIL), per-NDA diagnostics, models + git_sha rendering |

Cumulative: **260 tests passing** across 6 packages (+42 today).

### DEFERRED.md hygiene

Three items moved to **Completed** (per the deferred-tasks protocol):
- **DEF-001**: Resend inbound MX on `ask.parasol.co.ke` — Tim verified today.
- **DEF-005**: Voyage AI payment method — Tim added card; standard rate limits active. Sprint 1 fixture corpus (~1,116 chunks) embedded successfully.
- **DEF-008**: Sentry PII scrubbing — completed Sprint 1 Day 1; framework-agnostic scrubber in `apps/web/src/lib/pii-scrub.ts` is wired to `beforeSend` in both Sentry configs.

Remaining open items relevant to Sprint 1: DEF-009 (RLS continuous, applies forever), DEF-027 (dataset expansion), DEF-028 (counsel review of playbook + annotations — moved to v1-launch gate per Tim's instruction), DEF-043 (outbound delivery telemetry).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18 successful, 18 total
→ Zero TS errors, zero lint warnings, 260 tests passing

pnpm --filter @parasol/eval run eval -- --pipeline=stub-oracle --no-corpus
→ All 5 NDAs scored, F1 = 1.000 across the board
→ Acceptance bar: PASS

pnpm --filter @parasol/eval run eval:gate
→ eval gate PASS for sprint-1, exit 0

pnpm --filter @parasol/eval run eval -- --pipeline=stub-noisy --no-corpus
→ Aggregate F1 ≈ 0.50, citation validity = 0.50
→ Acceptance bar: FAIL (clause F1 below 0.85, citation validity below 1.0)
→ Diagnostics correctly identify missed / extra / invalid per NDA
```

Confirms the harness penalises the right things AND lets clean stubs through.

## Database state

Unchanged from Day 5. All 6 statutes (~1,116 chunks) ingested with embeddings + tags. No new migrations today.

## What is NOT done

- **Real-pipeline eval** — blocked by the production orchestrator (Day 9). Until then, `--pipeline=production` deliberately throws so a misconfigured CI gate can't silently pass under stub conditions. The `sprint-1.json` baseline currently in `packages/eval/results/` is from the stub-oracle pipeline (clearly labelled `pipeline: "stub"`); Day 13 overwrites with the production result.
- **Hallucination check on real PDFs/DOCX** — disabled (sourceText: null) until Day 7 wires document extraction. The metric still works for plaintext fixtures and for the production runner (which will pass extracted text directly).
- **Annotation counsel review** — same DEF-028 path as the playbook. Sprint 1 ships with `annotated_by: parasol-internal-draft`; absolute scores from production pipeline are best read as relative until counsel review.
- **20-NDA full annotation set** — only 5 of 20 are annotated. The plan calls for 20 by Day 13. I'll annotate the remaining 15 incrementally over Days 7-13.
- **Lawyer-rated redline appropriateness** — sampled at 20% per the plan; that's a manual scoring step that runs against actual production output. Day 13 task.

## Exact next step (Day 7) — Pipeline stages 1-4 (the cheap Haiku stages)

Day 7 plan from `docs/sprint-1-plan.md`:
1. `packages/ai/src/prompts/quality-assess.ts` — per-page quality scoring (PageQuality output schema)
2. `packages/ai/src/prompts/extract-text-clean.ts` — Haiku clean-PDF/DOCX extraction
3. `packages/ai/src/prompts/extract-text-degraded.ts` — Sonnet vision extraction for scans / photos
4. `packages/ai/src/prompts/triage.ts` — contract type + jurisdiction + parties identification
5. `packages/ai/src/prompts/extract-clauses.ts` — structured clause decomposition
6. `packages/ai/src/stages/` — one Stage per prompt (declares modelRole, runs the prompt with cache control, validates output schema)
7. `packages/ai/src/orchestrator.ts` — shell of the orchestrator with stages 1-4 wired; stages 5-10 stub (return empty)
8. Unit tests for triage stage output schema conformance against 5 NDA fixtures

Day 7 has no Tim action items.

## Tim action items still open

- **DEF-028** (counsel review): playbook + annotations both ship with `status: draft`. Production gate is v1 launch.
- Optional: re-verify Voyage usage on the dashboard to confirm the eval suite + corpus ingestion stayed within the 200M-token free quota. We're under it but worth a check on Day 13 once eval has run in earnest.
