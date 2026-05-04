import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveModel,
  DEFAULT_MODEL_BY_ROLE,
  readEnvModels,
  cachedTextBlock,
  plainTextBlock,
  createMessage,
  overrideClient,
} from './index'

// ─── resolveModel ────────────────────────────────────────────────────────────

describe('resolveModel', () => {
  it('returns env override when present for each role', () => {
    expect(resolveModel('haiku', { haiku: 'h-X' })).toBe('h-X')
    expect(resolveModel('sonnet', { sonnet: 's-X' })).toBe('s-X')
    expect(resolveModel('opus', { opus: 'o-X' })).toBe('o-X')
  })

  it('falls back to DEFAULT_MODEL_BY_ROLE when env is empty', () => {
    expect(resolveModel('haiku', {})).toBe(DEFAULT_MODEL_BY_ROLE.haiku)
    expect(resolveModel('sonnet', {})).toBe(DEFAULT_MODEL_BY_ROLE.sonnet)
    expect(resolveModel('opus', {})).toBe(DEFAULT_MODEL_BY_ROLE.opus)
  })

  it('does not bleed across roles', () => {
    expect(resolveModel('haiku', { sonnet: 's-X' })).toBe(DEFAULT_MODEL_BY_ROLE.haiku)
  })
})

describe('readEnvModels', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('reads ANTHROPIC_MODEL_* env vars', () => {
    process.env['ANTHROPIC_MODEL_HAIKU'] = 'h-env'
    process.env['ANTHROPIC_MODEL_SONNET'] = 's-env'
    process.env['ANTHROPIC_MODEL_OPUS'] = 'o-env'
    expect(readEnvModels()).toEqual({
      haiku: 'h-env',
      sonnet: 's-env',
      opus: 'o-env',
    })
  })

  it('returns undefined for unset env vars', () => {
    delete process.env['ANTHROPIC_MODEL_HAIKU']
    delete process.env['ANTHROPIC_MODEL_SONNET']
    delete process.env['ANTHROPIC_MODEL_OPUS']
    expect(readEnvModels()).toEqual({
      haiku: undefined,
      sonnet: undefined,
      opus: undefined,
    })
  })
})

// ─── cache helpers ───────────────────────────────────────────────────────────

describe('cachedTextBlock', () => {
  it('marks the block as ephemeral for prompt caching', () => {
    expect(cachedTextBlock('playbook content')).toEqual({
      type: 'text',
      text: 'playbook content',
      cache_control: { type: 'ephemeral' },
    })
  })
})

describe('plainTextBlock', () => {
  it('produces an uncached text block', () => {
    expect(plainTextBlock('per-call content')).toEqual({
      type: 'text',
      text: 'per-call content',
    })
    expect(plainTextBlock('x')).not.toHaveProperty('cache_control')
  })
})

// ─── createMessage ──────────────────────────────────────────────────────────

describe('createMessage', () => {
  beforeEach(() => {
    overrideClient(null)
  })
  afterEach(() => {
    overrideClient(null)
  })

  it('resolves the model from role and forwards to the SDK', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg_123' })
    overrideClient({ messages: { create } } as never)

    await createMessage({
      modelRole: 'sonnet',
      modelEnv: { sonnet: 'claude-sonnet-test' },
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(create).toHaveBeenCalledTimes(1)
    const args = create.mock.calls[0]![0] as Record<string, unknown>
    expect(args.model).toBe('claude-sonnet-test')
    expect(args.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('passes through cached system blocks unchanged', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg_123' })
    overrideClient({ messages: { create } } as never)

    const system = [cachedTextBlock('big playbook'), plainTextBlock('per-call')]
    await createMessage({
      modelRole: 'sonnet',
      modelEnv: { sonnet: 'm' },
      system,
      messages: [{ role: 'user', content: 'hello' }],
    })

    const args = create.mock.calls[0]![0] as Record<string, unknown>
    expect(args.system).toBe(system)
  })

  it('uses ANTHROPIC_DEFAULT_MAX_TOKENS env or hard default of 8192 when omitted', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg_123' })
    overrideClient({ messages: { create } } as never)
    delete process.env['ANTHROPIC_DEFAULT_MAX_TOKENS']

    await createMessage({
      modelRole: 'haiku',
      modelEnv: { haiku: 'm' },
      messages: [{ role: 'user', content: 'hi' }],
    })

    const args = create.mock.calls[0]![0] as Record<string, unknown>
    expect(args.max_tokens).toBe(8192)
  })

  it('respects an explicit maxTokens override', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg_123' })
    overrideClient({ messages: { create } } as never)

    await createMessage({
      modelRole: 'haiku',
      modelEnv: { haiku: 'm' },
      maxTokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    })

    const args = create.mock.calls[0]![0] as Record<string, unknown>
    expect(args.max_tokens).toBe(256)
  })
})
