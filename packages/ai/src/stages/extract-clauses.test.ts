import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractClausesStage } from './extract-clauses'
import { extractClausesOutputSchema } from './types'
import { overrideClient } from '../index'
import { __testing as extractClausesTesting } from '../prompts/extract-clauses'
import type { OrchestratorContext, PipelineEvent } from '../types'
// Re-import the playbook clause vocabulary indirectly via the test helper.
// Day 7 keeps the vocabulary inlined in the prompt; the test asserts it's
// in sync with what the playbook actually ships.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

const fakeMessage = (json: object) => ({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  model: 'm',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
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

describe('extractClausesStage — vocabulary stays in sync with playbook', () => {
  it('every NDA_CLAUSE_VOCABULARY id appears in packages/playbooks/kenya/nda.yaml', () => {
    const playbookPath = resolve(__dirname, '../../../playbooks/kenya/nda.yaml')
    const text = readFileSync(playbookPath, 'utf8')
    const parsed = parseYaml(text) as { clauses: Array<{ id: string }> }
    const playbookIds = new Set(parsed.clauses.map((c) => c.id))
    for (const promptId of extractClausesTesting.NDA_CLAUSE_VOCABULARY) {
      expect(playbookIds.has(promptId)).toBe(true)
    }
  })
})

describe('extractClausesStage — schema parsing', () => {
  it('parses a typical model response into clauses[]', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      clauses: [
        {
          clauseId: 'governing_law',
          displayName: 'Governing law',
          rawText: 'This Agreement shall be governed by the laws of Delaware.',
          sectionReference: 'Section 12',
          clauseOrder: 0,
        },
        {
          clauseId: 'unknown_1',
          displayName: 'Notices',
          rawText: 'All notices shall be sent to the addresses set forth above.',
          clauseOrder: 1,
        },
      ],
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()

    const out = await extractClausesStage.run({
      fullText: 'document body',
      contractType: 'nda',
    }, ctx)

    expect(out.clauses).toHaveLength(2)
    expect(out.clauses[0]!.clauseId).toBe('governing_law')
    expect(out.clauses[0]!.sectionReference).toBe('Section 12')
    expect(out.clauses[1]!.sectionReference).toBeUndefined()
  })

  it('rejects empty fullText without calling the LLM', async () => {
    const create = vi.fn()
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    await expect(
      extractClausesStage.run({ fullText: '', contractType: 'nda' }, ctx),
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('schema accepts empty clauses array (model says no clauses)', () => {
    expect(extractClausesOutputSchema.safeParse({ clauses: [] }).success).toBe(true)
  })

  it('schema rejects clauses missing required fields', () => {
    expect(extractClausesOutputSchema.safeParse({
      clauses: [{ clauseId: 'x' /* missing displayName, rawText, clauseOrder */ }],
    }).success).toBe(false)
  })
})
