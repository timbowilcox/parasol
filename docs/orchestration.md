# AI Orchestration

A contract review is not one prompt. It is a versioned pipeline of stages, each with its own model, prompt, validation, and tests.

## Stage architecture

```ts
interface Stage<Input, Output> {
  name: string;                              // e.g. "extract-clauses"
  version: string;                           // semver, increment on change
  modelRole: 'haiku' | 'sonnet' | 'opus';    // resolved to env var at runtime
  prompt: PromptArtefact;                    // versioned, in packages/ai/src/prompts/
  inputSchema: ZodSchema<Input>;
  outputSchema: ZodSchema<Output>;
  cacheable: boolean;                        // playbook context = yes; per-document = no
  retry: { maxAttempts: number; backoff: 'linear' | 'exponential' };
  evalCases: string[];                       // golden dataset case ids that exercise this stage
  run(input: Input, ctx: OrchestratorContext): Promise<Output>;
}
```

Every stage is defined in `packages/ai/src/stages/`. Every prompt is a separate file in `packages/ai/src/prompts/`. Prompts are versioned, tested, and treated as code — diffs reviewed in PRs.

**Stages declare a model role, not a specific model.** The orchestrator resolves the role to a concrete model via env var at call time. This lets us A/B test models per stage without rewriting stage code, and lets workspace-tier-based overrides (Business+ getting Opus on heavy stages, Solo on Sonnet) become a one-line config change rather than a refactor.

## Stage sequence (NDA review example)

| # | Stage | Model role | Sprint 1 model | Cached? | Purpose |
|---|-------|------------|----------------|---------|---------|
| 1 | `quality-assess` | haiku | Haiku 4.5 | No | Per-page quality scoring; routes to vision if needed |
| 2 | `extract-text` (clean) | haiku | Haiku 4.5 | No | Clean digital extraction |
| 2b | `extract-text` (degraded) | sonnet | Sonnet 4.7 (vision) | No | Vision extraction on scans/photos |
| 3 | `triage` | haiku | Haiku 4.5 | No | Identify contract type, jurisdiction, parties |
| 4 | `extract-clauses` | haiku | Haiku 4.5 | No | Decompose contract into structured clauses with hierarchy |
| 5 | `compare-playbook` | sonnet | Sonnet 4.7 → **Opus 4.7 in Sprint 2 A/B** | Playbook context cached | For each clause, identify deviations from standard position |
| 6 | `retrieve-authority` | (deterministic, not LLM) | — | No | Pull supporting authority for each flagged deviation |
| 7 | `generate-redline` | sonnet | Sonnet 4.7 → **Opus 4.7 in Sprint 2 A/B** | Playbook + corpus chunks cached | Produce redline with citations and confidence |
| 8 | `verify-citations` | sonnet | Sonnet 4.7 + deterministic | No | Validate every citation resolves; check claims against source text |
| 9 | `defined-terms-check` | haiku | Haiku 4.5 | No | Cross-reference defined terms across the document |
| 10 | `assemble-output` | (deterministic) | — | No | Render to .docx tracked changes + email body + web view |

Stages 1-4 can pipeline (next stage starts as soon as prior produces partial output for streaming). Stages 5-7 must complete sequentially. Stage 8 gates output release. Stage 9 runs in parallel to 5-7 over input. Stage 10 awaits all.

## Model selection rationale

Three-tier routing balances reasoning depth, latency, and cost.

**Haiku 4.5** — fast (typically 1-3s for these stages), cheap, good at pattern-match and structured extraction. Used for: quality assessment, classification (triage), clean-input extraction, structured clause decomposition, defined-terms cross-reference.

**Sonnet 4.7** — current Sprint 1 default for reasoning stages. Strong legal reasoning, vision capability, lower cost and latency than Opus. Used for: degraded-input vision extraction, playbook comparison, redline generation, citation verification.

**Opus 4.7** — frontier reasoning. ~5× Sonnet's per-token cost, ~1.5-2× the wall-clock latency. Genuinely better on long-context multi-constraint reasoning tasks (holding playbook + clause + authority + market norm + Kenyan idiom simultaneously while drafting). **Not the Sprint 1 default.** Sprint 2 A/B tests Opus on `compare-playbook` and `generate-redline` per DEF-041. Decision criteria: adopt Opus on a stage if F1 improves >2 points, redline appropriateness improves >0.2/5, or hallucination drops >0.5%, *and* p95 latency stays under the 60s Sprint 1 / 45s v1 launch bar.

## Per-review token economics

Approximate cost on a typical 12-page NDA:

**Sprint 1 baseline (Sonnet on heavy stages):**
- Haiku stages: ~30k input + 8k output tokens → ~$0.05
- Sonnet stages with cache hit on playbook: ~25k input (10k cached) + 6k output → ~$0.15
- Voyage embeddings + rerank: negligible
- **Total: ~$0.20 per review**

**Hypothetical Sprint 2 with Opus on compare-playbook + generate-redline (if A/B wins):**
- Haiku stages: ~$0.05
- Sonnet stages (verify-citations only): ~$0.05
- Opus stages with cache hit on playbook: ~25k input (10k cached) + 6k output → ~$0.50
- **Total: ~$0.60 per review**

Degraded input adds Sonnet vision pass: ~$0.10-0.15 per page on the affected pages.

At v1 launch volume (~1,500 reviews/month) the Opus delta is ~$600/month — meaningful but trivial against revenue.

## Prompts as artefacts

Every prompt lives in `packages/ai/src/prompts/<stage-name>.ts`:

```ts
export const extractClausesPrompt = definePrompt({
  name: 'extract-clauses',
  version: '1.2.0',
  modelRole: 'haiku',
  system: `You are a legal document parser. ...`,
  userTemplate: ({ documentText, contractType }: ExtractClausesInput) => `...`,
  outputSchema: extractClausesOutputSchema,
  examples: [/* few-shot examples for prompt stability */],
});
```

Every prompt file has a sibling `<stage-name>.test.ts` that runs the prompt against a small unit-test set of inputs and validates output schema conformance. Eval suite covers full-pipeline behaviour; unit tests cover individual prompt stability.

## Caching strategy

Anthropic prompt caching is aggressive:

- **Playbook context**: cached for the duration of a review session (~5 minutes). When orchestrator processes a contract for workspace W with playbook P, the playbook content is included in the cached prefix on every Sonnet/Opus call within that session.
- **Corpus authority chunks**: cached per-clause-flag. When `compare-playbook` flags a clause and `retrieve-authority` returns 3 supporting chunks, those chunks become part of the cached prefix for `generate-redline`.
- **System prompts**: cached indefinitely. They rarely change.

This typically reduces Sonnet/Opus input cost by 60-70% relative to no caching.

## Retry and degradation

Each stage defines retry policy. Default: 2 retries with exponential backoff. On final failure:

| Stage | Failure handling |
|-------|------------------|
| quality-assess | Default to "manual review recommended" tag on whole doc; proceed |
| extract-text | Return user-friendly error; no review produced |
| triage | If contract type unclassifiable, prompt user to confirm |
| extract-clauses | If structure fails, fall back to flat clause list |
| compare-playbook | If a clause comparison fails, mark that clause "manual review"; continue others |
| generate-redline | If redline generation fails for a flag, return the flag with current/recommended text only, no rewrite |
| verify-citations | If citation fails resolution, drop confidence to medium and add validator note. If all citations fail, abort review with error |
| defined-terms-check | Best-effort; failures are non-blocking |

The orchestrator collects partial successes. A review with 8 successful flags and 1 failed flag is still useful; the user is informed about the 1 failure transparently.

## Confidence calibration

Confidence is produced by the reasoning model inline during `generate-redline`:

- **High**: clear playbook violation, well-supported by authority, common pattern in market
- **Medium**: deviation from playbook but defensible position; or limited supporting authority; or unusual contract context
- **Manual review recommended**: ambiguous clause, novel context, conflicting authority, low corpus support

Then post-validated:
- High that fails citation validator → drops to Medium
- Medium that fails citation validator → drops to Manual review
- High where Voyage rerank score < threshold → drops to Medium

UI displays confidence as dot+label; never numeric percentages.

## Idempotency and replay

Every review produces a `reviews.id` and a `runs` row capturing model versions, prompt versions, playbook version, corpus version. A review can be replayed deterministically against the same configuration; the run log is the source of truth for "why did Parasol say what it said."

This matters for:
- Regression debugging when a customer flags an output
- Audit defence (a regulator asks how a flag was generated)
- Eval suite reproducibility
- Per-stage A/B testing (DEF-041): replay the same input through different model configurations to measure delta

## Observability

Per-run metrics emitted to `audit_log`:
- Stage timings (p50, p95)
- Token counts per stage
- Cache hit rates
- Retry counts
- Final confidence distribution
- Citation validation outcomes

Dashboard at `/admin/observability` (internal, Sprint 7+).

## Adding a new stage

1. Add `Stage` definition in `packages/ai/src/stages/<name>.ts` with a `modelRole`
2. Add prompt in `packages/ai/src/prompts/<name>.ts`
3. Add Zod schemas for input and output
4. Add unit test for prompt stability
5. Wire into orchestrator (`packages/ai/src/orchestrator.ts`)
6. Add eval cases that exercise the stage
7. Run eval; verify no regression
8. Document in this file
