# Handoff: Sprint 1, Day 7 — Pipeline stages 1-4 + orchestrator shell

Date: 2026-05-04
Session type: Sprint 1 Day 7

## What was completed

Day 7 scope per `docs/sprint-1-plan.md`: orchestration stages 1-4 (the cheap Haiku stages) plus the orchestrator shell. Stages 5-10 (the heavy Sonnet reasoning + assemble-output) land Day 8-9; this handoff stubs them so the orchestrator runs end to end against the eval harness.

### Stage I/O types (`packages/ai/src/stages/types.ts`)

Single source of truth for the data flowing through the pipeline. Notable types:
- `PageInput` — either pre-extracted text or a base64 image (intake plumbing decides which); refined to require one of the two.
- `QualityAssessOutput` — per-page `qualityScore` (0-1), `isClean` flag, `issues[]`, plus a document-level `recommendedRoute: 'clean' | 'degraded'`.
- `TriageOutput` — `contractType` (NDA/DPA/MSA/SaaS/employment/lease/distribution/unknown), `jurisdiction` (kenya/uganda/tanzania/rwanda/unknown — non-EAC inputs report 'unknown' so downstream stages flag the mismatch), `parties[]`, calibrated confidence, one-sentence reasoning.
- `ExtractedClauseDraft` — clause id (matches playbook vocabulary or `unknown_<n>`), display name, **verbatim** raw text (needed for the Day 8 hallucination check), section reference, 0-indexed clause order.

All schemas are required-fields-only; no `.default()` calls on the output schemas, because Zod's `.default()` creates an input/output type asymmetry that breaks the `Stage<I,O>` interface contract. The prompts instruct the model to always emit the field, even if empty.

### Generic stage runner (`packages/ai/src/stages/runner.ts`)

The single place that knows about LLM transport + JSON parsing. Every stage delegates to `executeStage({ stage, input, ctx })`, which:
1. Validates input against the stage's `inputSchema` (programming error if invalid → throws, no retry).
2. Builds the system prefix using `cachedTextBlock` (system prompt cached for 5-min TTL; playbook + authority chunks added when the stage requests them — Day 8 stages will).
3. Calls `createMessage` with the resolved model.
4. Extracts the assistant's text content.
5. JSON-parses the response with `tolerantJsonParse` — strips ```json fences, recovers JSON embedded in prose.
6. Validates against `outputSchema`. On failure, retries per the stage's `retry` policy (default 3 attempts, exponential backoff 250ms / 500ms / 1000ms).
7. Emits `started`/`retried`/`completed`/`failed` `PipelineEvent`s with token usage + cache hit counts at each transition.

`tolerantJsonParse` is exported and unit-tested separately because LLM output cleanup is a frequent source of bugs. Handles fences, prose-wrapped JSON, and arrays-vs-objects.

### Five prompts (`packages/ai/src/prompts/`)

- **`quality-assess.ts`** (Haiku, v0.1.0) — per-page quality classification. Threshold 0.7 routes to clean.
- **`extract-text-clean.ts`** (Haiku, v0.1.0) — strips repeated headers/footers, rejoins reflow paragraphs, preserves hierarchy markers verbatim. Explicitly instructs the model NOT to paraphrase or "improve" clause text.
- **`extract-text-degraded.ts`** (Sonnet, v0.1.0) — vision pass for scans/photos. Same DO/DON'T list as clean. The intake-pipeline plumbing (Day 9) attaches actual image content blocks; Day 7 ships the text framing.
- **`triage.ts`** (Haiku, v0.1.0) — classifies contract type, jurisdiction, parties, calibrated confidence, one-sentence reasoning. Documents that non-EAC governing law → `jurisdiction: 'unknown'` so downstream can flag.
- **`extract-clauses.ts`** (Haiku, v0.1.0) — decomposes the document into structured clauses keyed against the playbook's controlled vocabulary. The vocabulary is inlined in the prompt (15 NDA clause ids) and a unit test asserts it stays in sync with `kenya/nda.yaml`.

Every prompt declares `version: '0.1.0'`. Eval gates against version regressions per stage.

### Five stages (`packages/ai/src/stages/`)

`quality-assess.ts`, `extract-text-clean.ts`, `extract-text-degraded.ts`, `triage.ts`, `extract-clauses.ts` — each ~25 lines, all delegating to `executeStage`. Stages declare their `modelRole` (Haiku for 1-2-3-4-5, Sonnet for 2b's vision), `cacheable: false` (per-document state), `retry: DEFAULT_RETRY` (3 attempts exp backoff), and an empty `evalCases[]` (Day 13 populates).

### Orchestrator shell (`packages/ai/src/orchestrator.ts`)

`runOrchestrator(input)` runs the four stages sequentially:
1. `quality-assess` → routes to one of:
2. `extract-text-clean` (Haiku) **or** `extract-text-degraded` (Sonnet vision)
3. `triage` → if `contractType` ∉ `acceptedContractTypes`, returns early with `{ unsupported: { reason: 'unsupported_contract_type', detail } }` (no extract-clauses call). Sprint 1's accepted set is `['nda']`.
4. `extract-clauses` → returns `OrchestratorRunResult`.

Stages 5-10 are deliberately not wired. The result shape includes empty `issues[]` and `citations[]` placeholders so the eval harness sees a coherent (if thin) `PipelineOutput`. Day 8 lands the heavy stages (compare-playbook, generate-redline, verify-citations) and replaces the placeholders.

`SPRINT_1_ACCEPTED_CONTRACT_TYPES` exported as `['nda']` so the route handler / eval harness can pass it without re-defining.

### Tests added (30 new)

| Suite | Tests |
|-------|-------|
| `packages/ai/src/stages/runner.test.ts` | 12 — `tolerantJsonParse` (raw, fenced, prose-wrapped, array, empty, no-JSON), executeStage happy path with token-usage events, input-schema rejection (no LLM call, no retry), output schema retry (3 attempts → success), exhausted retries, model env override propagation |
| `packages/ai/src/stages/triage.test.ts` | 9 — schema conformance against 5 NDA fixtures (nda-001/009/010/013/015), unknown-contract-type accepted, empty fullText rejected without LLM call, parties required (model omitting it triggers retry exhaustion), explicit empty parties accepted |
| `packages/ai/src/stages/extract-clauses.test.ts` | 5 — vocabulary stays in sync with `kenya/nda.yaml`, schema parsing for typical response, empty fullText rejection, schema accepts empty clauses array, schema rejects clauses missing required fields |
| `packages/ai/src/orchestrator.test.ts` | 4 — happy path through stages 1-4, degraded route uses Sonnet vision, unsupported contract type short-circuits before stage 4, PipelineEvents forwarded to caller-supplied sink |

Cumulative repo test count: **290 passing across 6 packages** (+30 today).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18/18 successful
→ Zero TS errors, zero lint warnings
→ 290 tests passing across all packages
```

## Database state

Unchanged from Day 6. No migrations today; this work is purely orchestration / prompt / schema.

## What is NOT done

- **Heavy reasoning stages (compare-playbook, generate-redline, verify-citations)** — Day 8.
- **Assemble-output (DOCX tracked changes generation, email body)** — Day 9.
- **Defined-terms-check** — Day 9.
- **Real document intake plumbing** — PDF byte-extraction, DOCX-to-text, image rasterization for vision still need to land in `apps/web/src/lib/intake/`. The orchestrator accepts `PageInput` already; the pre-stage pipeline that produces `PageInput[]` from a Resend attachment is Day 9-10.
- **Production end-to-end run on a real NDA** — needs all of the above. Day 13 reflows.
- **Eval gate flipped to `--pipeline=production`** — Day 9 once the orchestrator is whole.

## Known issues / technical notes

- The stage runner's retry-with-exponential-backoff is intentionally simple (250ms × 2^attempt). When real eval data shows 429s from Anthropic, Day 8+ may upgrade to honour `retry-after` headers. No DEFERRED entry yet; the existing simple backoff is fine until we observe a problem.
- `quality-assess` currently uses a heuristic summary in its user template (text-char count + has-image flag) rather than full-page content. Cheap and probably good enough for Sprint 1; Day 13 eval will tell us if mis-routes are common.
- The vocabulary in `extract-clauses.ts` is hard-coded to NDA. Day 8 (DPA/MSA/SaaS) doesn't ship in v1, but the structure already supports extending: add a per-contract-type vocabulary mapping when those playbooks land in Sprint 4+.

## Exact next step (Day 8) ⚠️ Voyage rerank-2 quota check (was DEF-005, now resolved)

Day 8 plan from `docs/sprint-1-plan.md`:
1. **`packages/ai/src/prompts/compare-playbook.ts`** — Sonnet prompt; playbook context cached; outputs clause-level deviation objects.
2. **`packages/ai/src/prompts/generate-redline.ts`** — Sonnet prompt; playbook + corpus chunks cached; outputs issues + redline text + citations.
3. **`packages/ai/src/prompts/verify-citations.ts`** — Sonnet + deterministic validator; every cited authority resolved in corpus.
4. **`packages/ai/src/stages/{compare-playbook,generate-redline,verify-citations}.ts`** — wire prompts into the Stage interface using `executeStage`.
5. **`packages/ai/src/citation-validator.ts`** — deterministic layer that re-resolves every citation against `corpus_documents` (CLAUDE.md hard requirement: "Anything claiming 'DPA 2019 s.40' must resolve in the corpus or the redline regenerates"). Drops confidence high → medium on citation failure; medium → manual_review.
6. **Confidence calibration** wired through generate-redline → verify-citations.
7. **Orchestrator extended** with stages 5-7 (and 6 retrieve-authority is deterministic-not-LLM, calling `retrieveAuthority` from `@parasol/corpus`).
8. **Tim**: light-touch task — re-check Voyage AI dashboard once we run any meaningful retrievals (~Day 13). The original `sprint:1 day 8` Voyage quota check is now redundant since payment was added.

Day 8 has no Tim action items beyond the optional dashboard check.

## Tim action items still open

- **DEF-028** (counsel review of playbook + annotations): production gate is v1 launch. No immediate action.
- **DEF-011** (.co.ug, .co.tz, .co.rw domain registration): was Day 1 task, status unknown to me. Not blocking Sprint 1.
