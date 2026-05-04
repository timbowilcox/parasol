// Generic stage executor.
//
// Every stage follows the same shape:
//   1. Build messages from the prompt's system + userTemplate(input)
//   2. Call createMessage with the stage's modelRole
//   3. Extract the assistant's text content
//   4. Parse it as JSON (tolerating ```json fences and surrounding prose)
//   5. Validate against the stage's outputSchema
//   6. On parse / validation failure: retry per the stage's retry policy
//   7. Emit pipeline events at started / completed / failed / retried boundaries
//   8. Return the validated output
//
// This file is the only place that knows about the LLM transport and JSON
// parsing concerns. Each individual stage just declares its prompt + schemas
// and calls executeStage.

import type { Message, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { PipelineError } from '@parasol/core'
import { createMessage, cachedTextBlock } from '../client'
import type {
  Stage,
  PromptArtefact,
  OrchestratorContext,
  PipelineEvent,
  RetryPolicy,
} from '../types'

// ─── executeStage — the canonical run() implementation ──────────────────────

export interface ExecuteStageParams<TInput, TOutput> {
  stage: Stage<TInput, TOutput>
  input: TInput
  ctx: OrchestratorContext
  // Optional: include the playbook context in the system prefix as a cached
  // block. Set true for compare-playbook / generate-redline (Day 8).
  // Day-7 stages all leave this false — they don't read the playbook.
  includePlaybookContext?: boolean
  // Optional: include corpus authority chunks. Day 8 generate-redline only.
  includeAuthorityChunks?: boolean
}

export async function executeStage<TInput, TOutput>(
  params: ExecuteStageParams<TInput, TOutput>,
): Promise<TOutput> {
  const { stage, input, ctx } = params

  // Validate input first — wrong shape in is a programming error, not an
  // LLM error, so we fail loud and don't retry.
  const inputCheck = stage.inputSchema.safeParse(input)
  if (!inputCheck.success) {
    throw new PipelineError(
      `${stage.name}: input failed schema validation: ${inputCheck.error.message}`,
      stage.name,
    )
  }

  const startedAt = Date.now()
  ctx.emitEvent({
    stage: stage.name,
    status: 'started',
    modelRole: stage.modelRole,
    promptVersion: stage.prompt.version,
  })

  let lastError: unknown
  for (let attempt = 1; attempt <= stage.retry.maxAttempts; attempt++) {
    try {
      const messages = buildMessages(stage.prompt, input)
      const system = buildSystem(stage.prompt, ctx, params)
      const response = await createMessage({
        modelRole: stage.modelRole,
        system,
        messages,
        modelEnv: ctx.modelEnv,
      })

      const text = extractAssistantText(response)
      const parsed = tolerantJsonParse(text)
      const validated = stage.outputSchema.safeParse(parsed)
      if (!validated.success) {
        throw new PipelineError(
          `${stage.name}: output failed schema validation on attempt ${attempt}: ${validated.error.message}`,
          stage.name,
        )
      }

      ctx.emitEvent({
        stage: stage.name,
        status: 'completed',
        modelRole: stage.modelRole,
        promptVersion: stage.prompt.version,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? undefined,
        cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
        durationMs: Date.now() - startedAt,
        retryCount: attempt - 1,
      })
      return validated.data
    } catch (err) {
      lastError = err
      if (attempt < stage.retry.maxAttempts) {
        ctx.emitEvent({
          stage: stage.name,
          status: 'retried',
          modelRole: stage.modelRole,
          retryCount: attempt,
          errorMessage: (err as Error).message,
        })
        await delayForBackoff(stage.retry, attempt)
      }
    }
  }

  ctx.emitEvent({
    stage: stage.name,
    status: 'failed',
    modelRole: stage.modelRole,
    durationMs: Date.now() - startedAt,
    retryCount: stage.retry.maxAttempts - 1,
    errorMessage: (lastError as Error)?.message,
  })
  throw new PipelineError(
    `${stage.name}: exhausted ${stage.retry.maxAttempts} attempts; last error: ${(lastError as Error)?.message}`,
    stage.name,
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMessages<TInput, TOutput>(
  prompt: PromptArtefact<TInput, TOutput>,
  input: TInput,
): MessageParam[] {
  return [{ role: 'user', content: prompt.userTemplate(input) }]
}

function buildSystem<TInput, TOutput>(
  prompt: PromptArtefact<TInput, TOutput>,
  ctx: OrchestratorContext,
  params: ExecuteStageParams<TInput, TOutput>,
): string | TextBlockParam[] {
  const blocks: TextBlockParam[] = [cachedTextBlock(prompt.system)]
  if (params.includePlaybookContext && ctx.playbookContext) {
    blocks.push(cachedTextBlock(`# Playbook context\n\n${ctx.playbookContext}`))
  }
  if (params.includeAuthorityChunks && ctx.authorityChunks.length > 0) {
    blocks.push(cachedTextBlock(`# Authority chunks\n\n${ctx.authorityChunks.join('\n\n')}`))
  }
  // If only the system prompt is present, return as a plain string so we
  // don't pay the structured-system overhead unnecessarily.
  return blocks.length === 1 ? prompt.system : blocks
}

// Best-effort assistant-text extraction: assistant messages may have multiple
// content blocks but we expect text-only output for these stages.
function extractAssistantText(response: Message): string {
  for (const block of response.content) {
    if (block.type === 'text') return block.text
  }
  return ''
}

// Tolerate ```json fences and prose around the JSON body. If the response
// contains a JSON object, return it; otherwise throw so the retry path fires.
export function tolerantJsonParse(raw: string): unknown {
  if (!raw.trim()) {
    throw new Error('empty response from model')
  }
  // Strip ```json or ``` fences if present.
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/m)
  const candidate = fenced?.[1] ?? raw

  try {
    return JSON.parse(candidate.trim())
  } catch {
    // Find the first balanced { ... } block in the response and try that.
    const objStart = candidate.indexOf('{')
    const arrStart = candidate.indexOf('[')
    let start = -1
    let endChar = '}'
    if (objStart === -1 && arrStart === -1) {
      throw new Error('response did not contain JSON')
    }
    if (objStart === -1) {
      start = arrStart
      endChar = ']'
    } else if (arrStart === -1) {
      start = objStart
      endChar = '}'
    } else {
      start = Math.min(objStart, arrStart)
      endChar = candidate[start] === '{' ? '}' : ']'
    }
    const end = candidate.lastIndexOf(endChar)
    if (end <= start) {
      throw new Error('response did not contain a parseable JSON block')
    }
    const sliced = candidate.slice(start, end + 1)
    return JSON.parse(sliced)
  }
}

async function delayForBackoff(retry: RetryPolicy, attempt: number): Promise<void> {
  // Linear: 250ms, 500ms, 750ms, ...; Exponential: 250ms, 500ms, 1000ms, ...
  const baseMs = 250
  const ms = retry.backoff === 'exponential'
    ? baseMs * Math.pow(2, attempt - 1)
    : baseMs * attempt
  await new Promise((r) => setTimeout(r, ms))
}

// Default retry policy used by Day 7 stages. 2 retries on top of the initial
// attempt = 3 total. Matches docs/orchestration.md's default.
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, backoff: 'exponential' }

// Re-export for stages that want to compose their PipelineEvent shape.
export type { PipelineEvent }
