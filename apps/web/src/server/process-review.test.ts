import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We mock heavy dependencies at the module boundary. process-review.ts is
// the orchestration glue; the unit test here verifies it routes to the
// right helpers, handles the unsupported / failed branches, and constructs
// the reply correctly. End-to-end behaviour is exercised by Day 13's live
// smoke tests.

vi.mock('@parasol/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/ai')>()
  return {
    ...actual,
    runOrchestrator: vi.fn(),
    retrieveAuthority: vi.fn(),
  }
})

vi.mock('@parasol/playbooks', () => ({
  loadPlaybook: vi.fn(async () => ({ name: 'kenya/nda', clauses: [] })),
  serialisePlaybookForContext: vi.fn(() => 'PLAYBOOK MARKDOWN'),
}))

vi.mock('@parasol/corpus', () => ({
  CorpusRepository: vi.fn().mockImplementation(() => ({
    findLatestDocument: vi.fn(async () => null),
  })),
}))

vi.mock('@/lib/intake/extract-pages.js', () => ({
  extractPages: vi.fn(),
}))

vi.mock('@/lib/email/resend-send.js', () => ({
  fetchInboundAttachment: vi.fn(),
  sendReply: vi.fn(),
}))

vi.mock('./pipeline-events.js', () => ({
  bindEventsToReview: vi.fn(() => () => undefined),
}))

const updateStatusMock = vi.fn(async () => ({ id: 'r-1' }))
const updateAssembledMock = vi.fn(async () => ({ id: 'r-1' }))
const insertManyClausesMock = vi.fn(async () => [])
const insertManyIssuesMock = vi.fn(async (rows: { clause_id: string }[]) =>
  rows.map((r, i) => ({ id: `iss-${i}`, clause_id: r.clause_id })),
)
const insertManyCitationsMock = vi.fn(async () => [])

vi.mock('@parasol/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/core')>()
  return {
    ...actual,
    ReviewRepository: vi.fn().mockImplementation(() => ({
      updateStatus: updateStatusMock,
      updateAssembled: updateAssembledMock,
    })),
    ExtractedClauseRepository: vi.fn().mockImplementation(() => ({
      insertMany: insertManyClausesMock,
    })),
    IssueRepository: vi.fn().mockImplementation(() => ({
      insertMany: insertManyIssuesMock,
    })),
    CitationRepository: vi.fn().mockImplementation(() => ({
      insertMany: insertManyCitationsMock,
    })),
  }
})

import { processReview } from './process-review'
import { runOrchestrator } from '@parasol/ai'
import { extractPages } from '@/lib/intake/extract-pages'
import { fetchInboundAttachment, sendReply } from '@/lib/email/resend-send'

const baseInput = {
  supabase: {} as never,
  reviewId: 'r-1',
  workspaceId: 'ws-1',
  attachment: {
    kind: 'email' as const,
    inboundEmailId: 'em-1',
    attachmentId: 'att-1',
    filename: 'contract.pdf',
  },
  replyEmail: {
    replyTo: 'sender@example.com',
    emailMessageId: '<msg@example.com>',
    originalSubject: 'NDA review',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  updateStatusMock.mockResolvedValue({ id: 'r-1' } as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('processReview — happy path', () => {
  it('runs the pipeline and sends a reply with the redline DOCX', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    })
    vi.mocked(extractPages).mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: 'NDA body' }],
      rawCharCount: 8,
    })
    vi.mocked(runOrchestrator).mockResolvedValue({
      reviewId: 'r-1',
      issues: [],
      citations: [],
      assembled: {
        webView: {
          reviewId: 'r-1',
          contractType: 'nda',
          jurisdiction: 'kenya',
          parties: [],
          summary: { critical: 0, material: 0, minor: 0, citationValidityRate: 1 },
          issues: [],
          definedTerms: [],
        },
        email: {
          subjectSuffix: 'Parasol review · 0 issues',
          plainText: 'plain',
          html: '<!doctype html><html></html>',
        },
        redlineDocxBase64: 'UEsDBA==',
      },
    } as never)
    vi.mocked(sendReply).mockResolvedValue({ ok: true, id: 'em_reply' })

    const result = await processReview(baseInput)

    expect(result).toEqual({ ok: true, status: 'completed', replyMessageId: 'em_reply' })
    expect(updateStatusMock).toHaveBeenCalledWith('r-1', 'processing')
    expect(updateStatusMock).toHaveBeenCalledWith('r-1', 'completed')
    expect(sendReply).toHaveBeenCalledTimes(1)
    const sendArg = vi.mocked(sendReply).mock.calls[0]![0]
    expect(sendArg.to).toBe('sender@example.com')
    expect(sendArg.subject).toContain('Re: NDA review')
    expect(sendArg.subject).toContain('Parasol review')
    expect(sendArg.attachments?.[0]!.filename).toBe('contract-redlined.docx')
    expect(sendArg.attachments?.[0]!.contentBase64).toBe('UEsDBA==')
  })
})

describe('processReview — unsupported branch', () => {
  it('marks the review unsupported and sends an explainer reply when extraction fails', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
    })
    vi.mocked(extractPages).mockResolvedValue({
      ok: false,
      reason: 'unsupported_mime',
      detail: 'received application/zip',
    })
    vi.mocked(sendReply).mockResolvedValue({ ok: true, id: 'em_explainer' })

    const result = await processReview(baseInput)

    expect(result.status).toBe('unsupported')
    expect(updateStatusMock).toHaveBeenCalledWith('r-1', 'unsupported', 'received application/zip')
    const sendArg = vi.mocked(sendReply).mock.calls[0]![0]
    expect(sendArg.text).toContain('We were unable to process it')
    expect(sendArg.attachments).toBeUndefined()
  })

  it('marks the review unsupported when triage classifies it outside the accepted set', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    })
    vi.mocked(extractPages).mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: 'Some MSA text' }],
      rawCharCount: 13,
    })
    vi.mocked(runOrchestrator).mockResolvedValue({
      reviewId: 'r-1',
      issues: [],
      citations: [],
      unsupported: {
        reason: 'unsupported_contract_type',
        detail: 'triage classified as msa',
      },
    } as never)
    vi.mocked(sendReply).mockResolvedValue({ ok: true, id: 'em_explainer' })

    const result = await processReview(baseInput)

    expect(result.status).toBe('unsupported')
    expect(updateStatusMock).toHaveBeenCalledWith('r-1', 'unsupported', 'triage classified as msa')
  })
})

describe('processReview — failed branches', () => {
  it('marks the review failed when the attachment fetch fails', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: false,
      status: 404,
      detail: 'attachment not found',
    })

    const result = await processReview(baseInput)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('attachment_fetch_failed')
    expect(updateStatusMock).toHaveBeenCalledWith('r-1', 'failed', expect.stringContaining('attachment_fetch_failed'))
  })

  it('marks the review failed when there is no attachment id', async () => {
    const result = await processReview({
      ...baseInput,
      attachment: { ...baseInput.attachment, attachmentId: null },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('no_attachment')
  })

  it('marks the review failed when the orchestrator throws', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    })
    vi.mocked(extractPages).mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: 'NDA' }],
      rawCharCount: 3,
    })
    vi.mocked(runOrchestrator).mockRejectedValue(new Error('quality stage timed out'))

    const result = await processReview(baseInput)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('orchestrator_failed')
    expect(result.reason).toContain('quality stage timed out')
  })
})

describe('processReview — subject formatting', () => {
  it('does not double-prefix Re:', async () => {
    vi.mocked(fetchInboundAttachment).mockResolvedValue({
      ok: true, bytes: new Uint8Array([1]), contentType: 'application/pdf',
    })
    vi.mocked(extractPages).mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: 'NDA' }],
      rawCharCount: 3,
    })
    vi.mocked(runOrchestrator).mockResolvedValue({
      reviewId: 'r-1', issues: [], citations: [],
      assembled: {
        webView: {
          reviewId: 'r-1', contractType: 'nda', jurisdiction: 'kenya',
          parties: [], summary: { critical: 0, material: 0, minor: 0, citationValidityRate: 1 },
          issues: [], definedTerms: [],
        },
        email: { subjectSuffix: 'review · 0 issues', plainText: 'p', html: 'h' },
        redlineDocxBase64: 'UEsDBA==',
      },
    } as never)
    vi.mocked(sendReply).mockResolvedValue({ ok: true, id: 'em' })

    await processReview({
      ...baseInput,
      replyEmail: { ...baseInput.replyEmail, originalSubject: 'Re: NDA' },
    })

    const sendArg = vi.mocked(sendReply).mock.calls[0]![0]
    // Subject should be "Re: NDA — review · 0 issues", not "Re: Re: NDA …"
    expect(sendArg.subject.startsWith('Re: Re:')).toBe(false)
    expect(sendArg.subject.startsWith('Re: NDA')).toBe(true)
  })
})

