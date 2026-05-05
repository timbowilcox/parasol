import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendReply, fetchInboundAttachment } from './resend-send'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_API_KEY = process.env['RESEND_API_KEY']
const ORIGINAL_FROM = process.env['PARASOL_OUTBOUND_FROM']

beforeEach(() => {
  process.env['RESEND_API_KEY'] = 'test-key'
  process.env['PARASOL_OUTBOUND_FROM'] = 'Parasol <hello@parasol.co.ke>'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env['RESEND_API_KEY']
  } else {
    process.env['RESEND_API_KEY'] = ORIGINAL_API_KEY
  }
  if (ORIGINAL_FROM === undefined) {
    delete process.env['PARASOL_OUTBOUND_FROM']
  } else {
    process.env['PARASOL_OUTBOUND_FROM'] = ORIGINAL_FROM
  }
})

describe('sendReply', () => {
  it('POSTs to /emails with the right body shape', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ id: 'em_123' }), { status: 200 })
    }) as never

    const result = await sendReply({
      to: 'sender@example.com',
      inReplyTo: '<orig@example.com>',
      subject: 'Re: NDA',
      text: 'plain body',
      html: '<p>html body</p>',
      attachments: [{ filename: 'redlined.docx', contentBase64: 'AAAA' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.id).toBe('em_123')
    expect(capturedUrl).toBe('https://api.resend.com/emails')
    expect(capturedInit?.method).toBe('POST')

    const body = JSON.parse(capturedInit!.body as string)
    expect(body.from).toBe('Parasol <hello@parasol.co.ke>')
    expect(body.to).toEqual(['sender@example.com'])
    expect(body.subject).toBe('Re: NDA')
    expect(body.text).toBe('plain body')
    expect(body.html).toBe('<p>html body</p>')
    expect(body.headers['In-Reply-To']).toBe('<orig@example.com>')
    expect(body.headers['References']).toBe('<orig@example.com>')
    expect(body.attachments).toEqual([{ filename: 'redlined.docx', content: 'AAAA' }])

    const headers = capturedInit!.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-key')
  })

  it('returns a structured failure when the API returns non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as never

    const result = await sendReply({
      to: 'a@b.com',
      subject: 's',
      text: 't',
      html: 'h',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(429)
    expect(result.detail).toContain('rate limited')
  })

  it('returns a failure when RESEND_API_KEY is missing', async () => {
    delete process.env['RESEND_API_KEY']
    const result = await sendReply({ to: 'a@b.com', subject: 's', text: 't', html: 'h' })
    expect(result.ok).toBe(false)
  })
})

describe('fetchInboundAttachment', () => {
  it('hits the inbound metadata endpoint, then follows download_url for the bytes', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, headers: (init?.headers as Record<string, string>) ?? {} })
      if (u.startsWith('https://api.resend.com/emails/receiving/')) {
        // Stage 1: metadata
        return new Response(
          JSON.stringify({
            id: 'att_1',
            filename: 'NDA.pdf',
            content_type: 'application/pdf',
            download_url: 'https://signed.example.com/blob/abc?sig=xyz',
            expires_at: '2026-05-05T13:00:00Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (u.startsWith('https://signed.example.com/')) {
        // Stage 2: bytes from presigned URL
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      return new Response('unexpected', { status: 500 })
    }) as never

    const result = await fetchInboundAttachment({
      emailId: 'em_1',
      attachmentId: 'att_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes.length).toBe(4)
    expect(result.contentType).toBe('application/pdf')

    // First call: metadata endpoint, with Bearer auth
    expect(calls[0]!.url).toBe('https://api.resend.com/emails/receiving/em_1/attachments/att_1')
    expect(calls[0]!.headers['Authorization']).toBe('Bearer test-key')

    // Second call: the presigned URL, no Authorization header
    expect(calls[1]!.url).toBe('https://signed.example.com/blob/abc?sig=xyz')
    expect(calls[1]!.headers['Authorization']).toBeUndefined()
  })

  it('returns failure when the metadata endpoint 404s (wrong namespace, missing id, etc.)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ statusCode: 404, message: 'Email not found' }), { status: 404 }),
    ) as never
    const result = await fetchInboundAttachment({ emailId: 'em_1', attachmentId: 'att_1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })

  it('returns failure when metadata response lacks download_url', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'att_1', filename: 'x.pdf' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as never
    const result = await fetchInboundAttachment({ emailId: 'em_1', attachmentId: 'att_1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail).toContain('download_url')
  })

  it('returns failure when the presigned download itself errors', async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.startsWith('https://api.resend.com/')) {
        return new Response(
          JSON.stringify({ download_url: 'https://signed.example.com/blob/expired' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('signature expired', { status: 403 })
    }) as never
    const result = await fetchInboundAttachment({ emailId: 'em_1', attachmentId: 'att_1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(403)
    expect(result.detail).toContain('download failed')
  })
})
