# @parasol/ai

Anthropic Claude orchestration: stages, prompts, the orchestrator, and the singleton client. Three-tier model routing (Haiku 4.5 / Sonnet 4.7 / Opus 4.7) per `docs/orchestration.md`.

## Structure

```
src/
├── index.ts          # Public exports — Orchestrator only; stages internal
├── client.ts         # Singleton Anthropic client (Opus 4.7 + Sonnet 4.7 + Haiku 4.5 + ZDR)
├── orchestrator.ts   # Resolves modelRole → concrete model; runs stage pipeline
├── stages/           # One file per stage (triage, extract-clauses, ...)
├── prompts/          # Versioned prompt artefacts (one per stage, semver in filename)
├── types/            # Internal types (Stage, OrchestratorContext, StageResult)
└── voyage.ts         # Voyage embeddings + rerank client
```

## Stage interface

Stages declare a *role* (`'haiku' | 'sonnet' | 'opus'`), not a concrete model. The orchestrator resolves to a model via env var at call time:

```ts
interface Stage<I, O> {
  name: string;
  version: string;
  modelRole: 'haiku' | 'sonnet' | 'opus';
  prompt: PromptArtefact;
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  cacheable: boolean;
  retry: { maxAttempts: number; backoff: 'linear' | 'exponential' };
  evalCases: string[];
  run(input: I, ctx: OrchestratorContext): Promise<O>;
}
```

This indirection enables Sprint 2's Opus 4.7 A/B test (DEF-041) without touching stage code: change one env var, re-run eval, compare deltas.

## Sprint 1 stages

Implemented Sprint 1 (NDA-only):
- `quality-assess` (haiku) — page-level quality scoring
- `extract-text` (haiku/sonnet) — clean digital → haiku, degraded → sonnet vision
- `triage` (haiku) — contract type detection; routes only NDAs to Sprint 1 pipeline
- `extract-clauses` (haiku) — structured clause decomposition
- `compare-playbook` (sonnet, Sprint 2 A/B → opus) — clause vs playbook position
- `retrieve-authority` (deterministic) — corpus retrieval per flagged clause
- `generate-redline` (sonnet, Sprint 2 A/B → opus) — cited recommendations
- `verify-citations` (sonnet + deterministic) — claim decomposition and source check
- `defined-terms-check` (haiku) — cross-reference defined terms
- `assemble-output` (deterministic) — render to .docx + email + web view

Sprint 1 ships with all stages running on the Sprint 1 baseline. Sprint 2 day 1 runs the A/B test.

## Conventions

- **Prompts are code.** Versioned, code-reviewed, paired with eval cases. New prompt version = new file + new eval run.
- **Output is always validated.** Every stage's output schema is enforced before returning. Validation failures retry with structured-output reminder, then fail the review with a flagged status (not a silent corruption).
- **Cache on what's stable.** Playbook content is cached across reviews; per-document content is not. See client.ts for prompt-caching wrapper.
- **No multi-vendor in v1.** Single Anthropic client. Multi-vendor abstraction is DEF-035, deferred to v2.
