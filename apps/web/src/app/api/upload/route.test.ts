import { describe, it, expect, beforeEach, vi } from 'vitest'

// Module mocks at the boundary. The route handler under test only orchestrates
// requireAuth → multipart parse → review create → after()-handoff; the
// handoff itself is exercised by process-review.test.ts.

const requireAuthMock = vi.fn(async () => ({
  id: 'user-1',
  workspaceId: 'ws-1',
  role: 'owner' as const,
  isParasolAdmin: false,
}))
vi.mock('@/server/auth', () => ({
  requireAuth: () => requireAuthMock(),
}))

const createReviewMock = vi.fn(async () => ({ id: 'review-abc' }))
vi.mock('@parasol/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/core')>()
  return {
    ...actual,
    ReviewRepository: vi.fn().mockImplementation(() => ({
      create: createReviewMock,
    })),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({})),
}))

const processReviewMock = vi.fn(async (_input: unknown) => ({ ok: true, status: 'completed' as const }))
vi.mock('@/server/process-review', () => ({
  processReview: (input: unknown) => processReviewMock(input),
}))

// next/server's `after` runs the callback in tests immediately so we can
// assert against processReview being invoked.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => { void cb() },
  }
})

import { POST } from './route'
import { NextRequest } from 'next/server'

beforeEach(() => {
  vi.clearAllMocks()
  createReviewMock.mockResolvedValue({ id: 'review-abc' } as never)
  processReviewMock.mockResolvedValue({ ok: true, status: 'completed' } as never)
  requireAuthMock.mockResolvedValue({
    id: 'user-1',
    workspaceId: 'ws-1',
    role: 'owner',
    isParasolAdmin: false,
  })
})

function buildRequest(form: FormData): NextRequest {
  return new NextRequest('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  })
}

describe('POST /api/upload', () => {
  it('creates a review and hands off to processReview on a valid PDF upload', async () => {
    const form = new FormData()
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'nda.pdf', { type: 'application/pdf' })
    form.append('file', file)

    const res = await POST(buildRequest(form))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.reviewId).toBe('review-abc')

    expect(createReviewMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      createdBy: 'user-1',
      intakeSource: 'web',
      contractType: null,
      originalFilename: 'nda.pdf',
    })

    expect(processReviewMock).toHaveBeenCalledTimes(1)
    const handoff = processReviewMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(handoff).toBeDefined()
    expect(handoff.reviewId).toBe('review-abc')
    expect(handoff.workspaceId).toBe('ws-1')
    expect(handoff.replyEmail).toBeUndefined()
    const att = handoff.attachment as { kind: string; filename: string; mimeType: string }
    expect(att.kind).toBe('inline')
    expect(att.filename).toBe('nda.pdf')
    expect(att.mimeType).toBe('application/pdf')
  })

  it('returns 400 when no file field is present', async () => {
    const form = new FormData()
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    expect(processReviewMock).not.toHaveBeenCalled()
  })

  it('returns 415 on an unsupported MIME with no recognisable extension', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'evil.exe', { type: 'application/x-msdownload' }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(415)
    expect(processReviewMock).not.toHaveBeenCalled()
  })

  it('returns 413 when the file exceeds 10 MB', async () => {
    const form = new FormData()
    const big = new Uint8Array(11 * 1024 * 1024)
    form.append('file', new File([big], 'big.pdf', { type: 'application/pdf' }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(413)
  })

  it('returns 400 on an empty file', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(0)], 'empty.pdf', { type: 'application/pdf' }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
  })

  it('infers DOCX MIME from the .docx filename when the browser sent application/octet-stream', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([0x50, 0x4B])], 'nda.docx', { type: 'application/octet-stream' }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(202)
    const handoff = processReviewMock.mock.calls[0]?.[0] as { attachment: { mimeType: string } }
    expect(handoff).toBeDefined()
    const att = handoff.attachment
    expect(att.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })
})
