import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOrchestrator, SPRINT_1_ACCEPTED_CONTRACT_TYPES } from './orchestrator.js'
import { overrideClient } from './index.js'

// Build an Anthropic SDK stub that responds to each consecutive call with
// the next stub message. Lets us drive the orchestrator deterministically
// through stages 1-4.
function sequencedClient(responses: object[]) {
  const queue = [...responses]
  const create = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('sequenced client exhausted')
    return {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(next) }],
      model: 'm',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }
  })
  return { client: { messages: { create } }, create }
}

beforeEach(() => overrideClient(null))
afterEach(() => overrideClient(null))

describe('runOrchestrator — happy path through stages 1-4', () => {
  it('produces quality, extractedText, triage, and clauses; issues/citations empty', async () => {
    const { client } = sequencedClient([
      // Stage 1: quality-assess
      {
        pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }],
        recommendedRoute: 'clean',
      },
      // Stage 2: extract-text-clean
      {
        pages: [{ pageNumber: 0, text: 'cleaned text body' }],
        fullText: 'cleaned text body',
      },
      // Stage 3: triage
      {
        contractType: 'nda',
        jurisdiction: 'kenya',
        parties: [{ role: 'Disclosing Party', name: 'Acme' }],
        confidence: 'high',
        reasoning: 'Standard NDA structure with Kenya governing law.',
      },
      // Stage 4: extract-clauses
      {
        clauses: [
          {
            clauseId: 'governing_law',
            displayName: 'Governing law',
            rawText: 'Kenya.',
            clauseOrder: 0,
          },
        ],
      },
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-1',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 'raw page text' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    expect(result.unsupported).toBeUndefined()
    expect(result.quality?.recommendedRoute).toBe('clean')
    expect(result.extractedText?.fullText).toBe('cleaned text body')
    expect(result.triage?.contractType).toBe('nda')
    expect(result.clauses).toHaveLength(1)
    expect(result.clauses?.[0]?.clauseId).toBe('governing_law')
    // Stages 5-10 are stubbed in Day 7 — issues / citations empty.
    expect(result.issues).toEqual([])
    expect(result.citations).toEqual([])
  })
})

describe('runOrchestrator — degraded route uses Sonnet vision extraction', () => {
  it('routes to extract-text-degraded when quality recommendation is degraded', async () => {
    const { client, create } = sequencedClient([
      {
        pages: [{ pageNumber: 0, qualityScore: 0.4, isClean: false, issues: ['skewed'] }],
        recommendedRoute: 'degraded',
      },
      {
        pages: [{ pageNumber: 0, text: 'sonnet-vision extracted body' }],
        fullText: 'sonnet-vision extracted body',
      },
      {
        contractType: 'nda',
        jurisdiction: 'kenya',
        parties: [],
        confidence: 'medium',
        reasoning: 'NDA inferred from extracted vision text.',
      },
      { clauses: [] },
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-2',
      workspaceId: 'ws-1',
      pages: [{
        pageNumber: 0,
        imageBase64: 'aGVsbG8=',
        imageMimeType: 'image/png',
      }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      modelEnv: { haiku: 'm', sonnet: 'sonnet-test' },
    })

    expect(result.extractedText?.fullText).toBe('sonnet-vision extracted body')
    // Verify Sonnet was used for stage 2b (call index 1)
    const calls = create.mock.calls as unknown as Array<[{ model: string }]>
    expect(calls[1]?.[0].model).toBe('sonnet-test')
  })
})

describe('runOrchestrator — unsupported contract type', () => {
  it('returns unsupported result without invoking extract-clauses', async () => {
    const { client, create } = sequencedClient([
      {
        pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }],
        recommendedRoute: 'clean',
      },
      {
        pages: [{ pageNumber: 0, text: 'service agreement body' }],
        fullText: 'service agreement body',
      },
      {
        contractType: 'msa',
        jurisdiction: 'kenya',
        parties: [],
        confidence: 'high',
        reasoning: 'Master services agreement structure with Kenya governing law.',
      },
      // Stage 4 should not be called.
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-3',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 'raw text' }],
      acceptedContractTypes: ['nda'],   // MSA not accepted
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    expect(result.unsupported?.reason).toBe('unsupported_contract_type')
    expect(result.unsupported?.detail).toContain('msa')
    expect(result.clauses).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(3)  // Stage 4 skipped
  })
})

describe('runOrchestrator — emits PipelineEvents to the supplied sink', () => {
  it('forwards every event the stages emit', async () => {
    const { client } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.9, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'Standard NDA structure with Kenya governing law.' },
      { clauses: [] },
    ])
    overrideClient(client as never)

    const captured: string[] = []
    await runOrchestrator({
      reviewId: 'r-4',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      modelEnv: { haiku: 'm', sonnet: 'm' },
      emitEvent: (e) => captured.push(`${e.stage}:${e.status}`),
    })
    // Each of the 4 stages should produce started + completed; the
    // orchestrator may emit one started or completed per stage.
    expect(captured.filter((s) => s.endsWith(':started'))).toHaveLength(4)
    expect(captured.filter((s) => s.endsWith(':completed'))).toHaveLength(4)
    expect(captured).toContain('quality-assess:started')
    expect(captured).toContain('extract-clauses:completed')
  })
})
