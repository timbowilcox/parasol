// AI orchestration types — stage interface, prompt artefacts, model role resolution.
// Stages declare a modelRole, not a concrete model. The orchestrator resolves the
// role to a model id at call time via environment variables. This lets us A/B-test
// models per stage (DEF-041) without rewriting stage code, and lets workspace-tier
// overrides (Business+ getting Opus on heavy stages) be a one-line config change.

import type { z, ZodSchema } from 'zod'
import type { ModelRole } from '@parasol/core'

export type { ModelRole }

// ─── Model resolution ────────────────────────────────────────────────────────

// Anthropic model ids returned by the role resolver. Concrete strings are
// configurable via env so we can pin to dated snapshots without code changes.
export interface ModelEnv {
  haiku?: string
  sonnet?: string
  opus?: string
}

// Defaults applied when env vars are unset. Match .env.example defaults.
// Sprint 1 baseline uses Sonnet on heavy stages; Sprint 2 A/B-tests Opus
// on compare-playbook + generate-redline per DEF-041.
export const DEFAULT_MODEL_BY_ROLE: Record<ModelRole, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-7',
  opus: 'claude-opus-4-7',
}

// Resolve a model role to a concrete model id. Reads from env vars first,
// falls back to DEFAULT_MODEL_BY_ROLE. Pure function for testability.
export function resolveModel(role: ModelRole, env: ModelEnv = readEnvModels()): string {
  return env[role] ?? DEFAULT_MODEL_BY_ROLE[role]
}

// Read env vars at call time. Kept separate so tests can supply ModelEnv
// directly without touching process.env.
export function readEnvModels(): ModelEnv {
  return {
    haiku: process.env['ANTHROPIC_MODEL_HAIKU'],
    sonnet: process.env['ANTHROPIC_MODEL_SONNET'],
    opus: process.env['ANTHROPIC_MODEL_OPUS'],
  }
}

// ─── Prompt artefacts ────────────────────────────────────────────────────────

// A versioned, testable prompt unit. Stored under packages/ai/src/prompts/.
// Each prompt has a sibling .test.ts that validates output schema conformance
// against fixture inputs. Prompt diffs are reviewed in PRs.
export interface PromptArtefact<TInput = unknown, TOutput = unknown> {
  name: string                       // e.g. 'extract-clauses' (matches stage name)
  version: string                    // semver; bump on any prompt text change
  modelRole: ModelRole
  system: string                     // system prompt; cacheable across calls
  userTemplate: (input: TInput) => string
  outputSchema: ZodSchema<TOutput>
  // Few-shot examples that ship with the prompt. Used by stage tests to
  // guard against prompt regressions; not sent on every call.
  examples?: Array<{ input: TInput; expectedOutput: TOutput }>
}

export function definePrompt<TInput, TOutput>(
  artefact: PromptArtefact<TInput, TOutput>,
): PromptArtefact<TInput, TOutput> {
  return artefact
}

// ─── Stage interface ─────────────────────────────────────────────────────────

export type RetryPolicy = {
  maxAttempts: number
  backoff: 'linear' | 'exponential'
}

export interface Stage<Input, Output> {
  name: string
  version: string
  modelRole: ModelRole
  prompt: PromptArtefact<Input, Output>
  inputSchema: ZodSchema<Input>
  outputSchema: ZodSchema<Output>
  // Whether the stage's input is cacheable across runs in a session.
  // Playbook context = true (same per workspace+contractType for ~5 min).
  // Per-document inputs = false.
  cacheable: boolean
  retry: RetryPolicy
  // Golden dataset case ids that exercise this stage. Populated by eval.
  evalCases: readonly string[]
  run(input: Input, ctx: OrchestratorContext): Promise<Output>
}

// ─── Orchestrator context ────────────────────────────────────────────────────

// Passed to every Stage.run(). Carries the things stages need without each
// stage having to know about the broader orchestrator.
export interface OrchestratorContext {
  reviewId: string
  workspaceId: string
  jurisdiction: string
  contractType: string
  // Pre-loaded playbook content suitable for inclusion in cached system prefix.
  // null when stage doesn't need it (e.g. quality-assess, triage).
  playbookContext: string | null
  // Cached corpus authority chunks for the current clause being processed.
  // Set by the orchestrator before invoking generate-redline.
  authorityChunks: readonly string[]
  // Where stages emit timing / token / retry events. Wires into pipeline_events.
  emitEvent: (event: PipelineEvent) => void
  // Optional model env override (for A/B testing — DEF-041).
  modelEnv?: ModelEnv
}

export interface PipelineEvent {
  stage: string
  status: 'started' | 'completed' | 'failed' | 'retried'
  modelRole?: ModelRole
  modelId?: string
  promptVersion?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  durationMs?: number
  retryCount?: number
  errorMessage?: string
}

// Helper to extract the input/output types of a Stage. Used by the orchestrator
// when wiring stages together.
export type StageInput<S> = S extends Stage<infer I, unknown> ? I : never
export type StageOutput<S> = S extends Stage<unknown, infer O> ? O : never

// Re-export z for convenience so prompt and stage files can have a single import.
export type { ZodSchema } from 'zod'
export type Infer<T extends ZodSchema> = z.infer<T>
