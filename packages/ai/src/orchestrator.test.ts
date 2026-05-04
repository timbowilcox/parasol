import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOrchestrator, SPRINT_1_ACCEPTED_CONTRACT_TYPES } from './orchestrator'
import { overrideClient } from './index'

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

// ─── Day 8: stages 5-8 end-to-end ───────────────────────────────────────────

describe('runOrchestrator — full pipeline (stages 1-8)', () => {
  it('runs compare-playbook → retrieve-authority → generate-redline → verify-citations', async () => {
    const { client, create } = sequencedClient([
      // Stage 1
      { pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      // Stage 2
      { pages: [{ pageNumber: 0, text: 'doc body' }], fullText: 'doc body' },
      // Stage 3
      { contractType: 'nda', jurisdiction: 'unknown', parties: [], confidence: 'high', reasoning: 'NDA classified.' },
      // Stage 4
      { clauses: [{ clauseId: 'governing_law', displayName: 'Governing law', rawText: 'Delaware.', clauseOrder: 0 }] },
      // Stage 5: compare-playbook
      {
        deviations: [{
          playbookClauseId: 'governing_law',
          matchedExtractedClauseId: 'governing_law',
          position: 'violation',
          severity: 'critical',
          confidence: 'high',
          currentText: 'Delaware.',
          reasoning: 'Delaware outside hard-limit set.',
        }],
      },
      // Stage 7: generate-redline (one call per deviation)
      {
        issue: {
          clauseId: 'governing_law',
          severity: 'critical',
          confidence: 'high',
          currentPosition: 'Delaware-governed.',
          recommendedPosition: 'Kenya-governed.',
          reasoning: 'Delaware is outside the playbook hard-limit set.',
          redlineText: 'This Agreement shall be governed by the laws of Kenya.',
          citations: [
            { source: 'kenya-statute', id: '1995/4', section: 's.36', validated: false },
          ],
        },
      },
      // Stage 9: defined-terms-check (clean document)
      { issues: [] },
    ])
    overrideClient(client as never)

    const retrieveAuthority = vi.fn(async () => ['Arbitration Act 1995 s.36 chunk text.'])
    const resolveCitation = vi.fn(async (_s: string, id: string) => id === '1995/4')

    const result = await runOrchestrator({
      reviewId: 'r-5',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook\n## Clause: governing_law\n...',
      retrieveAuthority,
      resolveCitation,
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    expect(result.unsupported).toBeUndefined()
    expect(result.deviations).toHaveLength(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.citations[0]!.validated).toBe(true)
    expect(result.citations).toHaveLength(1)
    expect(result.citationValidation?.totalCitations).toBe(1)
    expect(result.citationValidation?.resolvedCitations).toBe(1)
    expect(result.citationValidation?.issuesWithFailures).toBe(0)
    // 4 Haiku stages + 1 compare-playbook + 1 generate-redline + 1 defined-terms = 7 LLM calls
    expect(create).toHaveBeenCalledTimes(7)
    expect(retrieveAuthority).toHaveBeenCalledTimes(1)
    expect(retrieveAuthority).toHaveBeenCalledWith(expect.objectContaining({
      clauseId: 'governing_law',
    }))
  })

  it('stops after stage 4 when no playbookContext is supplied', async () => {
    const { client, create } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.9, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [{ clauseId: 'governing_law', displayName: 'GL', rawText: 'Kenya.', clauseOrder: 0 }] },
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-6',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      // playbookContext omitted on purpose
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })
    expect(result.deviations).toBeUndefined()
    expect(result.issues).toEqual([])
    expect(result.citations).toEqual([])
    expect(create).toHaveBeenCalledTimes(4)  // no compare-playbook / generate-redline
  })

  it('downgrades confidence on citation-resolution failure', async () => {
    const { client } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 'doc' }], fullText: 'doc' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [{ clauseId: 'data_protection', displayName: 'DP', rawText: 'Generic.', clauseOrder: 0 }] },
      {
        deviations: [{
          playbookClauseId: 'data_protection',
          matchedExtractedClauseId: 'data_protection',
          position: 'violation',
          severity: 'critical',
          confidence: 'high',
          currentText: 'Generic.',
          reasoning: 'No DPA-aware language.',
        }],
      },
      {
        issue: {
          clauseId: 'data_protection',
          severity: 'critical',
          confidence: 'high',  // model says high; verify-citations should drop this
          currentPosition: 'Generic.',
          recommendedPosition: 'DPA-aware.',
          reasoning: 'DPA s.49.',
          redlineText: 'DPA-compliant text.',
          citations: [
            { source: 'kenya-statute', id: 'fake-act-9999', section: 's.49', validated: false },
          ],
        },
      },
      // Stage 9: defined-terms-check (clean)
      { issues: [] },
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-7',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      retrieveAuthority: async () => [],
      resolveCitation: async () => false,  // every citation fails
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    expect(result.issues[0]!.confidence).toBe('medium')  // dropped from high
    expect(result.issues[0]!.citations[0]!.validated).toBe(false)
    expect(result.citationValidation?.unresolvedCitations).toBe(1)
  })

  it('graceful-degrades when generate-redline fails for one deviation', async () => {
    const queue = [
      { pages: [{ pageNumber: 0, qualityScore: 0.9, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [{ clauseId: 'governing_law', displayName: 'GL', rawText: 'X.', clauseOrder: 0 }] },
      {
        deviations: [{
          playbookClauseId: 'governing_law',
          matchedExtractedClauseId: 'governing_law',
          position: 'violation',
          severity: 'critical',
          confidence: 'high',
          currentText: 'X.',
          reasoning: 'r',
        }],
      },
      // generate-redline returns malformed JSON repeatedly → exhausts retries
      'not json',
      'not json',
      'not json',
    ]
    const create = vi.fn(async () => {
      const next = queue.shift()
      const text = typeof next === 'string' ? next : JSON.stringify(next)
      return {
        id: 'msg', type: 'message', role: 'assistant',
        content: [{ type: 'text', text }],
        model: 'm', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })
    overrideClient({ messages: { create } } as never)

    const result = await runOrchestrator({
      reviewId: 'r-8',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      retrieveAuthority: async () => [],
      resolveCitation: async () => true,
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    // The orchestrator surfaces a manual-review placeholder issue rather
    // than throwing, so the rest of the pipeline (verify-citations) still
    // runs and the user sees "we identified a problem here" instead of
    // silent omission.
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.confidence).toBe('manual_review_recommended')
    expect(result.issues[0]!.recommendedPosition).toContain('Manual review')
  })

  it('runs without retrieveAuthority/resolveCitation when both are null', async () => {
    const { client } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.9, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [{ clauseId: 'governing_law', displayName: 'GL', rawText: 'Kenya.', clauseOrder: 0 }] },
      { deviations: [] },  // compare-playbook says nothing to flag
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-9',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      retrieveAuthority: null,
      resolveCitation: null,
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })
    expect(result.deviations).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.citationValidation?.totalCitations).toBe(0)
  })

  // ─── Day 9 additions: stages 9 + 10 ─────────────────────────────────────

  it('produces assembled output (web view + email + DOCX) for the full 1-10 pipeline', async () => {
    const { client } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 'doc' }], fullText: 'doc' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [{ role: 'Disclosing', name: 'Acme' }], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [{ clauseId: 'governing_law', displayName: 'GL', rawText: 'Kenya.', clauseOrder: 0 }] },
      // Sequential order: stage 5 (compare) → stage 7 (redline loop) → stage 9 (defined-terms)
      { deviations: [{ playbookClauseId: 'governing_law', matchedExtractedClauseId: 'governing_law', position: 'standard', severity: 'minor', confidence: 'high', currentText: 'Kenya.', reasoning: 'r' }] },
      // Stage 7
      { issue: { clauseId: 'governing_law', severity: 'minor', confidence: 'high', currentPosition: 'Kenya.', recommendedPosition: 'OK.', reasoning: 'r', redlineText: 'Kenya.', citations: [] } },
      // Stage 9
      { issues: [] },
    ])
    overrideClient(client as never)

    const result = await runOrchestrator({
      reviewId: 'r-assembled',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      retrieveAuthority: async () => [],
      resolveCitation: async () => true,
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })

    expect(result.assembled).toBeDefined()
    expect(result.assembled?.webView.reviewId).toBe('r-assembled')
    expect(result.assembled?.email.plainText).toContain('governing_law')
    // DOCX is a zip; first two bytes are PK
    const bytes = Buffer.from(result.assembled!.redlineDocxBase64, 'base64')
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4B)
    expect(result.definedTerms).toEqual([])
  })

  it('emits an assemble-output PipelineEvent', async () => {
    const { client } = sequencedClient([
      { pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [] },
      { deviations: [] },
      { issues: [] },
    ])
    overrideClient(client as never)

    const captured: string[] = []
    await runOrchestrator({
      reviewId: 'r-events',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      modelEnv: { haiku: 'm', sonnet: 'm' },
      emitEvent: (e) => captured.push(`${e.stage}:${e.status}`),
    })
    expect(captured).toContain('assemble-output:started')
    expect(captured).toContain('assemble-output:completed')
  })

  it('survives defined-terms-check failures (best-effort, non-blocking)', async () => {
    const queue: unknown[] = [
      { pages: [{ pageNumber: 0, qualityScore: 0.95, isClean: true, issues: [] }], recommendedRoute: 'clean' },
      { pages: [{ pageNumber: 0, text: 't' }], fullText: 't' },
      { contractType: 'nda', jurisdiction: 'kenya', parties: [], confidence: 'high', reasoning: 'NDA.' },
      { clauses: [] },
      // Sequential: stage 5 (compare, returns no deviations) → stage 9
      // (defined-terms — returns garbage 3x, exhausts retries; orchestrator
      // catches and continues with empty definedTerms). Pipeline still
      // completes through stages 8 + 10.
      // dt-fail, dt-fail.
      { deviations: [] },
      'not json',
      'not json',
      'not json',
    ]
    const create = vi.fn(async () => {
      const next = queue.shift()
      const text = typeof next === 'string' ? next : JSON.stringify(next)
      return {
        id: 'msg', type: 'message', role: 'assistant',
        content: [{ type: 'text', text }],
        model: 'm', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })
    overrideClient({ messages: { create } } as never)

    const result = await runOrchestrator({
      reviewId: 'r-defined-terms-fail',
      workspaceId: 'ws-1',
      pages: [{ pageNumber: 0, text: 't' }],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext: '# Playbook',
      modelEnv: { haiku: 'm', sonnet: 'm' },
    })
    // definedTerms should be [] (graceful failure)
    expect(result.definedTerms).toEqual([])
    // Pipeline still completes — assembled output exists
    expect(result.assembled).toBeDefined()
  })
})
