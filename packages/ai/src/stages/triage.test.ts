import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { triageStage } from './triage'
import { triageOutputSchema } from './types'
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

// ─── Schema conformance against 5 representative NDA fixtures ───────────────
// Each fixture is a (model output, expected verdict) pair drawn from the
// 5 annotated NDAs in packages/eval/data/golden/nda/. Tests assert the
// triage stage validates the output cleanly and surfaces the right
// (contractType, jurisdiction, confidence).

const NDA_TRIAGE_FIXTURES = [
  {
    label: 'nda-001 (Calpine US M&A signed)',
    response: {
      contractType: 'nda',
      jurisdiction: 'unknown',  // Delaware — non-EAC
      parties: [
        { role: 'Disclosing Party', name: 'Calpine Corporation' },
        { role: 'Receiving Party', name: 'LS Power Equity Advisors' },
      ],
      confidence: 'high',
      reasoning: 'Confidentiality agreement structure with mutual disclosure provisions; governing law clause specifies Delaware (non-EAC).',
    },
  },
  {
    label: 'nda-009 (Common Paper US-Delaware template)',
    response: {
      contractType: 'nda',
      jurisdiction: 'unknown',
      parties: [
        { role: 'Disclosing Party', name: '' },
        { role: 'Receiving Party', name: '' },
      ],
      confidence: 'medium',
      reasoning: 'Common Paper Mutual NDA template; party names are placeholders.',
    },
  },
  {
    label: 'nda-010 (gov.uk template, UK)',
    response: {
      contractType: 'nda',
      jurisdiction: 'unknown',  // UK, non-EAC
      parties: [
        { role: 'Party A', name: '' },
        { role: 'Party B', name: '' },
      ],
      confidence: 'high',
      reasoning: 'UK government mutual NDA template; English law governing clause.',
    },
  },
  {
    label: 'nda-013 (Britam Kenya supplier NDA)',
    response: {
      contractType: 'nda',
      jurisdiction: 'kenya',
      parties: [
        { role: 'Disclosing Party', name: 'Britam Holdings Plc' },
        { role: 'Receiving Party', name: 'Counterparty' },
      ],
      confidence: 'high',
      reasoning: 'Kenyan supplier NDA; Kenya governing law clearly stated.',
    },
  },
  {
    label: 'nda-015 (Common Paper DOCX, US-Delaware)',
    response: {
      contractType: 'nda',
      jurisdiction: 'unknown',
      parties: [],
      confidence: 'medium',
      reasoning: 'Common Paper template form; party identification deferred to instance.',
    },
  },
]

describe('triageStage — schema conformance against NDA fixtures', () => {
  for (const fixture of NDA_TRIAGE_FIXTURES) {
    it(fixture.label, async () => {
      const create = vi.fn().mockResolvedValue(fakeMessage(fixture.response))
      overrideClient({ messages: { create } } as never)
      const { ctx } = buildCtx()
      const out = await triageStage.run({ fullText: 'document text' }, ctx)
      expect(out.contractType).toBe(fixture.response.contractType)
      expect(out.jurisdiction).toBe(fixture.response.jurisdiction)
      expect(out.confidence).toBe(fixture.response.confidence)
      // Output also passes the schema directly (sanity check).
      expect(triageOutputSchema.safeParse(fixture.response).success).toBe(true)
    })
  }
})

describe('triageStage — handles unknown contract type cleanly', () => {
  it('does not throw when contractType is unknown', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      contractType: 'unknown',
      jurisdiction: 'unknown',
      parties: [],
      confidence: 'manual_review_recommended',
      reasoning: 'Could not classify confidently from supplied text.',
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    const out = await triageStage.run({ fullText: 'ambiguous text' }, ctx)
    expect(out.contractType).toBe('unknown')
  })
})

describe('triageStage — input validation', () => {
  it('rejects empty fullText without calling the LLM', async () => {
    const create = vi.fn()
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    await expect(triageStage.run({ fullText: '' }, ctx)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('triageStage — parties is required', () => {
  it('rejects model output that omits parties field (retries until exhausted)', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      contractType: 'nda',
      jurisdiction: 'kenya',
      // parties intentionally omitted — schema requires it; model output
      // is rejected and retried per the stage's retry policy.
      confidence: 'high',
      reasoning: 'Standard NDA structure with Kenya governing law.',
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    await expect(triageStage.run({ fullText: 'document' }, ctx)).rejects.toThrow(/exhausted/)
  })

  it('accepts an explicitly empty parties array', async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({
      contractType: 'nda',
      jurisdiction: 'kenya',
      parties: [],
      confidence: 'high',
      reasoning: 'Standard NDA structure with Kenya governing law.',
    }))
    overrideClient({ messages: { create } } as never)
    const { ctx } = buildCtx()
    const out = await triageStage.run({ fullText: 'document' }, ctx)
    expect(out.parties).toEqual([])
  })
})
