import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { definedTermsCheckStage } from './defined-terms-check.js'
import { definedTermsCheckOutputSchema } from './types.js'
import { overrideClient } from '../index.js'
import type { OrchestratorContext, PipelineEvent } from '../types.js'

const fakeMessage = (json: object) => ({
  id: 'msg', type: 'message', role: 'assistant',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  model: 'm', stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 50, output_tokens: 25 },
})

const buildCtx = (): { ctx: OrchestratorContext; events: PipelineEvent[] } => {
  const events: PipelineEvent[] = []
  const ctx: OrchestratorContext = {
    reviewId: 'r-1',
    workspaceId: 'ws-1',
    jurisdiction: 'kenya',
    contractType: 'nda',
    playbookContext: null,
    authorityChunks: [],
    emitEvent: (e) => events.push(e),
    modelEnv: { haiku: 'm' },
  }
  return { ctx, events }
}

beforeEach(() => overrideClient(null))
afterEach(() => overrideClient(null))

describe('definedTermsCheckStage', () => {
  it('parses a typical model response into issues', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      issues: [
        {
          term: 'Permitted Recipients',
          kind: 'undefined_use',
          description: 'Used in clause 5 but never defined.',
          sectionReference: 'Section 5',
        },
        {
          term: 'Acquirer',
          kind: 'unused_definition',
          description: 'Defined at the top but never referenced.',
        },
      ],
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()

    const out = await definedTermsCheckStage.run({ fullText: 'document body' }, ctx)
    expect(out.issues).toHaveLength(2)
    expect(out.issues[0]!.term).toBe('Permitted Recipients')
    expect(out.issues[0]!.kind).toBe('undefined_use')
    expect(out.issues[1]!.sectionReference).toBeUndefined()
  })

  it('rejects empty fullText without calling the LLM', async () => {
    const create = vi.fn()
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    await expect(definedTermsCheckStage.run({ fullText: '' }, ctx)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('schema accepts empty issues array (clean document)', () => {
    expect(definedTermsCheckOutputSchema.safeParse({ issues: [] }).success).toBe(true)
  })

  it('schema rejects unknown kind enum', () => {
    expect(definedTermsCheckOutputSchema.safeParse({
      issues: [{ term: 'X', kind: 'made-up', description: 'd' }],
    }).success).toBe(false)
  })

  it('schema requires non-empty term', () => {
    expect(definedTermsCheckOutputSchema.safeParse({
      issues: [{ term: '', kind: 'undefined_use', description: 'd' }],
    }).success).toBe(false)
  })
})
