import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateRedlineStage } from './generate-redline'
import { generateRedlineOutputSchema } from './types'
import { overrideClient } from '../index'
import type { OrchestratorContext, PipelineEvent } from '../types'

const fakeMessage = (json: object) => ({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  model: 'm',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 150 },
})

const buildCtx = (
  playbookContext: string | null = '# Playbook\n...',
  authorityChunks: readonly string[] = [],
): { ctx: OrchestratorContext; events: PipelineEvent[] } => {
  const events: PipelineEvent[] = []
  const ctx: OrchestratorContext = {
    reviewId: 'r-1',
    workspaceId: 'ws-1',
    jurisdiction: 'kenya',
    contractType: 'nda',
    playbookContext,
    authorityChunks,
    emitEvent: (e) => events.push(e),
    modelEnv: { sonnet: 'm' },
  }
  return { ctx, events }
}

const sampleDeviation = {
  playbookClauseId: 'data_protection',
  matchedExtractedClauseId: 'data_protection',
  position: 'violation' as const,
  severity: 'critical' as const,
  confidence: 'high' as const,
  currentText: 'Personal data shall be handled in accordance with applicable laws.',
  reasoning: 'Generic compliance language; missing DPA 2019 processor obligations and cross-border transfer mechanism.',
}

const sampleIssue = {
  clauseId: 'data_protection',
  severity: 'critical' as const,
  confidence: 'high' as const,
  currentPosition: 'Generic compliance reference; no specific DPA obligations.',
  recommendedPosition:
    'Replace with DPA-2019-aware language: processor undertakes s.42 obligations, breach notification under s.43, cross-border transfer mechanism per s.49.',
  reasoning:
    'Kenya DPA 2019 imposes processor obligations that contractual generic-compliance language does not satisfy. Sections 42, 43, and 49 of the Act require specific processor undertakings.',
  redlineText: 'Where confidential information includes personal data, recipient acts as a data processor and complies with the Kenya Data Protection Act 2019, including sections 42 (processor duties), 43 (breach notification), and 49 (cross-border transfer).',
  citations: [
    { source: 'kenya-statute', id: '2019/24', section: 's.42', validated: false },
    { source: 'kenya-statute', id: '2019/24', section: 's.43', validated: false },
    { source: 'kenya-statute', id: '2019/24', section: 's.49', validated: false },
  ],
}

beforeEach(() => overrideClient(null))
afterEach(() => overrideClient(null))

describe('generateRedlineStage', () => {
  it('returns a structured PipelineIssue from the model response', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ issue: sampleIssue }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()

    const out = await generateRedlineStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      deviation: sampleDeviation,
    }, ctx)

    expect(out.issue.clauseId).toBe('data_protection')
    expect(out.issue.severity).toBe('critical')
    expect(out.issue.citations).toHaveLength(3)
    expect(out.issue.citations[0]!.source).toBe('kenya-statute')
    expect(out.issue.citations[0]!.validated).toBe(false)  // verify-citations promotes later
    expect(out.issue.redlineText).toContain('Data Protection Act')
  })

  it('attaches both playbook context AND authority chunks as cached blocks', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ issue: sampleIssue }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx(
      '# Playbook\n## Clause: data_protection\n...',
      ['DPA s.42 chunk text', 'DPA s.49 chunk text'],
    )

    await generateRedlineStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      deviation: sampleDeviation,
    }, ctx)

    const args = create.mock.calls[0]![0] as { system: unknown }
    expect(Array.isArray(args.system)).toBe(true)
    const blocks = args.system as Array<{ text: string; cache_control?: { type: string } }>
    // [system prompt, playbook block, authority block]
    expect(blocks).toHaveLength(3)
    expect(blocks[1]!.text).toContain('Playbook context')
    expect(blocks[2]!.text).toContain('Authority chunks')
    expect(blocks[2]!.text).toContain('DPA s.42 chunk text')
    expect(blocks[2]!.cache_control?.type).toBe('ephemeral')
  })

  it('omits the authority block when authorityChunks is empty', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ issue: sampleIssue }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx('# Playbook', [])

    await generateRedlineStage.run({
      contractType: 'nda',
      jurisdiction: 'kenya',
      deviation: sampleDeviation,
    }, ctx)

    const args = create.mock.calls[0]![0] as { system: unknown }
    const blocks = args.system as Array<{ text: string }>
    expect(blocks).toHaveLength(2)  // [system, playbook only]
  })

  it('schema rejects issue without redlineText field', () => {
    const broken = {
      issue: {
        clauseId: 'x',
        severity: 'critical',
        confidence: 'high',
        currentPosition: 'a',
        recommendedPosition: 'b',
        reasoning: 'r',
        // redlineText omitted
        citations: [],
      },
    }
    expect(generateRedlineOutputSchema.safeParse(broken).success).toBe(false)
  })

  it('schema accepts empty redlineText (e.g. missing-clause flag)', () => {
    const ok = {
      issue: { ...sampleIssue, redlineText: '' },
    }
    expect(generateRedlineOutputSchema.safeParse(ok).success).toBe(true)
  })

  it('schema rejects citation with invalid source enum', () => {
    const broken = {
      issue: {
        ...sampleIssue,
        citations: [{ source: 'made-up', id: 'x', validated: false }],
      },
    }
    expect(generateRedlineOutputSchema.safeParse(broken).success).toBe(false)
  })
})
