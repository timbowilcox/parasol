import { describe, it, expect, beforeEach, vi } from 'vitest'

const requireAuthMock = vi.fn(async () => ({
  id: 'u-1', workspaceId: 'ws-1', role: 'owner' as const, isParasolAdmin: false,
}))
vi.mock('@/server/auth', () => ({
  requireAuth: () => requireAuthMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({})),
}))

const getByIdMock = vi.fn()
vi.mock('@parasol/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/core')>()
  return {
    ...actual,
    ReviewRepository: vi.fn().mockImplementation(() => ({
      getById: getByIdMock,
    })),
  }
})

import { GET } from './route'
import { NextRequest } from 'next/server'

const buildRequest = () => new NextRequest('http://localhost/api/review/abc/redline.docx')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/review/[id]/redline.docx', () => {
  it('returns the decoded DOCX bytes on a completed review', async () => {
    const sourceBytes = Buffer.from('fake-docx-bytes')
    getByIdMock.mockResolvedValue({
      id: 'abc',
      status: 'completed',
      original_filename: 'contract.pdf',
      redline_docx_base64: sourceBytes.toString('base64'),
    })
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: 'abc' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('wordprocessingml')
    expect(res.headers.get('content-disposition')).toContain('contract-redlined.docx')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const out = Buffer.from(await res.arrayBuffer())
    expect(out.equals(sourceBytes)).toBe(true)
  })

  it('returns 404 when the review row is not found', async () => {
    getByIdMock.mockRejectedValue(new Error('not found'))
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when the review has no redline yet', async () => {
    getByIdMock.mockResolvedValue({
      id: 'abc',
      status: 'processing',
      original_filename: 'contract.pdf',
      redline_docx_base64: null,
    })
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: 'abc' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('redline_unavailable')
  })

  it('falls back to "redlined.docx" when the original filename is null', async () => {
    getByIdMock.mockResolvedValue({
      id: 'abc',
      status: 'completed',
      original_filename: null,
      redline_docx_base64: Buffer.from('x').toString('base64'),
    })
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: 'abc' }) })
    expect(res.headers.get('content-disposition')).toContain('redlined.docx')
  })
})
