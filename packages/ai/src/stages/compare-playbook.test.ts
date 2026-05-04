import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { comparePlaybookStage } from './compare-playbook.js'
import { comparePlaybookOutputSchema } from './types.js'
import { overrideClient } from '../index.js'
import type { OrchestratorContext, PipelineEvent } from '../types.js'

const fakeMessage = (json: object) => ({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  model: 'm',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 },
})

const buildCtx = (playbookContext: string | null = '# Playbook\n...'): { ctx: OrchestratorContext; events: PipelineEvent[] } => {
  const events: PipelineEvent[] = []
  const ctx: OrchestratorContext = {
    reviewId: 'r-1',
    workspaceId: 'ws-1',
    jurisdiction: 'kenya',
    contractType: 'nda',
    playbookContext,
    authorityChunks: [],
    emitEvent: (e) => events.push(e),
    modelEnv: { sonnet: 'm' },
  }
  return { ctx, events }
}

const sampleClauses = [
  {
    clauseId: 'governing_law',
    displayName: 'Governing law',
    rawText: 'This agreement is governed by the laws of Delaware.',
    sectionReference: 'Section 12',
    clauseOrder: 0,
  },
  {
    clauseId: 'data_protection',
    displayName: 'Data protection',
    rawText: 'Personal data shall be handled in accordance with applicable laws.',
    clauseOrder: 1,
  },
]

beforeEach(() => overrideClient(null))
afterEach(() => overrideClient(null))

describe('comparePlaybookStage', () => {
  it('returns deviations parsed from the model response', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      deviations: [
        {
          playbookClauseId: 'governing_law',
          matchedExtractedClauseId: 'governing_law',
          position: 'violation',
          severity: 'critical',
          confidence: 'high',
          currentText: 'This agreement is governed by the laws of Delaware.',
          reasoning: 'Delaware is outside the playbook hard-limit set (Kenya/UK/Singapore/Mauritius/NY).',
        },
        {
          playbookClauseId: 'data_protection',
          matchedExtractedClauseId: 'data_protection',
          position: 'violation',
          severity: 'critical',
          confidence: 'medium',
          currentText: 'Personal data shall be handled in accordance with applicable laws.',
          reasoning: 'Generic compliance language; no DPA 2019 processor obligations or cross-border transfer mechanism.',
        },
      ],
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()

    const out = await comparePlaybookStage.run({
      contractType: 'nda',
      jurisdiction: 'unknown',
      clauses: sampleClauses,
    }, ctx)

    expect(out.deviations).toHaveLength(2)
    expect(out.deviations[0]!.playbookClauseId).toBe('governing_law')
    expect(out.deviations[0]!.severity).toBe('critical')
    expect(out.deviations[1]!.playbookClauseId).toBe('data_protection')
  })

  it('emits a completed event with cache-read tokens captured', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ deviations: [] }))
    overrideClient({ messages: { create } } as never)
    const { ctx, events } = buildCtx()

    await comparePlaybookStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      clauses: sampleClauses,
    }, ctx)

    const completed = events.find((e) => e.status === 'completed')!
    expect(completed.stage).toBe('compare-playbook')
    expect(completed.cacheReadTokens).toBe(60)
  })

  it('passes the cached playbook context as a structured system block', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ deviations: [] }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx('# Playbook\n## Clause: governing_law\n...')

    await comparePlaybookStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      clauses: sampleClauses,
    }, ctx)

    const args = create.mock.calls[0]![0] as { system: unknown }
    // System should be an array (cached blocks), not a plain string, when
    // playbook context is supplied.
    expect(Array.isArray(args.system)).toBe(true)
    const blocks = args.system as Array<{ text: string; cache_control?: { type: string } }>
    expect(blocks).toHaveLength(2)
    expect(blocks[1]!.text).toContain('Playbook context')
    expect(blocks[1]!.cache_control?.type).toBe('ephemeral')
  })

  it('rejects empty clauses array via input schema (no LLM call)', async () => {
    const create = vi.fn()
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()

    await expect(comparePlaybookStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      clauses: [],
    }, ctx)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('schema accepts empty deviations array (model says no deviations)', () => {
    expect(comparePlaybookOutputSchema.safeParse({ deviations: [] }).success).toBe(true)
  })

  it('schema rejects deviation with unknown position enum', () => {
    expect(comparePlaybookOutputSchema.safeParse({
      deviations: [{
        playbookClauseId: 'x',
        matchedExtractedClauseId: '',
        position: 'totally-fine',
        severity: 'minor',
        confidence: 'high',
        currentText: '',
        reasoning: 'r',
      }],
    }).success).toBe(false)
  })
})
