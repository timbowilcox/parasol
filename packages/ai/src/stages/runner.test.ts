import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { executeStage, tolerantJsonParse, DEFAULT_RETRY } from './runner.js'
import { overrideClient, definePrompt } from '../index.js'
import type { Stage, OrchestratorContext, PipelineEvent } from '../types.js'
import { PipelineError } from '@parasol/core'

// ─── tolerantJsonParse ──────────────────────────────────────────────────────

describe('tolerantJsonParse', () => {
  it('parses raw JSON', () => {
    expect(tolerantJsonParse('{"a":1}')).toEqual({ a: 1 })
  })
  it('strips ```json fences', () => {
    expect(tolerantJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('strips bare ``` fences', () => {
    expect(tolerantJsonParse('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('extracts a JSON object embedded in prose', () => {
    expect(tolerantJsonParse('Sure, here you go: {"a":1} done.')).toEqual({ a: 1 })
  })
  it('extracts a JSON array embedded in prose', () => {
    expect(tolerantJsonParse('Result: [1,2,3] end')).toEqual([1, 2, 3])
  })
  it('throws on empty input', () => {
    expect(() => tolerantJsonParse('')).toThrow(/empty/)
    expect(() => tolerantJsonParse('   \n')).toThrow(/empty/)
  })
  it('throws when no JSON present', () => {
    expect(() => tolerantJsonParse('not json at all')).toThrow(/JSON/)
  })
})

// ─── executeStage — happy path, retries, validation ─────────────────────────

const makeStage = <I, O>(overrides: Partial<Stage<I, O>>): Stage<I, O> => ({
  name: 'test-stage',
  version: '0.0.0',
  modelRole: 'haiku',
  cacheable: false,
  retry: DEFAULT_RETRY,
  evalCases: [],
  prompt: definePrompt({
    name: 'test-prompt',
    version: '0.0.0',
    modelRole: 'haiku',
    system: 'system',
    userTemplate: () => 'user',
    outputSchema: z.object({ ok: z.boolean() }) as unknown as z.ZodSchema<O>,
  }),
  inputSchema: z.object({}) as unknown as z.ZodSchema<I>,
  outputSchema: z.object({ ok: z.boolean() }) as unknown as z.ZodSchema<O>,
  run: async () => ({ ok: true } as O),
  ...overrides,
})

const makeCtx = (events: PipelineEvent[]): OrchestratorContext => ({
  reviewId: 'r-1',
  workspaceId: 'ws-1',
  jurisdiction: 'kenya',
  contractType: 'nda',
  playbookContext: null,
  authorityChunks: [],
  emitEvent: (e) => events.push(e),
})

const fakeMessage = (text: string) => ({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text }],
  model: 'm',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
})

beforeEach(() => {
  overrideClient(null)
})
afterEach(() => {
  overrideClient(null)
})

describe('executeStage — happy path', () => {
  it('returns the validated output and emits started + completed events', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage('{"ok":true}'))
    overrideClient({ messages: { create } } as never)

    const events: PipelineEvent[] = []
    const inputSchema = z.object({ q: z.string() })
    const outputSchema = z.object({ ok: z.boolean() })
    const stage = makeStage({
      inputSchema: inputSchema as never,
      outputSchema: outputSchema as never,
    })

    const out = await executeStage<{ q: string }, { ok: boolean }>({
      stage: stage as never,
      input: { q: 'hi' },
      ctx: makeCtx(events),
    })
    expect(out).toEqual({ ok: true })
    expect(events.map((e) => e.status)).toEqual(['started', 'completed'])
    const completed = events.find((e) => e.status === 'completed')!
    expect(completed.inputTokens).toBe(10)
    expect(completed.outputTokens).toBe(5)
  })
})

describe('executeStage — input validation', () => {
  it('throws PipelineError without retrying when input fails schema', async () => {
    const create = vi.fn()
    overrideClient({ messages: { create } } as never)
    const events: PipelineEvent[] = []
    const stage = makeStage({
      inputSchema: z.object({ q: z.string() }) as never,
    })

    await expect(
      executeStage({
        stage: stage as never,
        input: { q: 42 } as never,
        ctx: makeCtx(events),
      }),
    ).rejects.toBeInstanceOf(PipelineError)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('executeStage — output schema retry', () => {
  it('retries on bad output, succeeds on a later attempt', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(fakeMessage('not json'))           // attempt 1
      .mockResolvedValueOnce(fakeMessage('{"ok":"wrong-type"}')) // attempt 2
      .mockResolvedValueOnce(fakeMessage('{"ok":true}'))         // attempt 3
    overrideClient({ messages: { create } } as never)

    const events: PipelineEvent[] = []
    const stage = makeStage({
      retry: { maxAttempts: 3, backoff: 'linear' },
    })

    const out = await executeStage({
      stage: stage as never,
      input: {},
      ctx: makeCtx(events),
    })
    expect(out).toEqual({ ok: true })
    expect(create).toHaveBeenCalledTimes(3)
    const statuses = events.map((e) => e.status)
    expect(statuses).toEqual(['started', 'retried', 'retried', 'completed'])
  })

  it('exhausts retries and throws PipelineError', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage('not json'))
    overrideClient({ messages: { create } } as never)

    const events: PipelineEvent[] = []
    const stage = makeStage({
      retry: { maxAttempts: 2, backoff: 'linear' },
    })

    await expect(
      executeStage({ stage: stage as never, input: {}, ctx: makeCtx(events) }),
    ).rejects.toThrow(/exhausted 2 attempts/)
    expect(create).toHaveBeenCalledTimes(2)
    expect(events[events.length - 1]!.status).toBe('failed')
  })
})

describe('executeStage — model env override propagates', () => {
  it('passes ctx.modelEnv to createMessage', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage('{"ok":true}'))
    overrideClient({ messages: { create } } as never)

    const events: PipelineEvent[] = []
    const stage = makeStage({})
    const ctx = { ...makeCtx(events), modelEnv: { haiku: 'claude-haiku-test' } }

    await executeStage({ stage: stage as never, input: {}, ctx })
    const args = create.mock.calls[0]![0] as { model: string }
    expect(args.model).toBe('claude-haiku-test')
  })
})
