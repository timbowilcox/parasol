import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendReply, fetchInboundAttachment } from './resend-send.js'

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
  it('GETs the attachment download URL with the API key', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = (init?.headers as Record<string, string>) ?? {}
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    }) as never

    const result = await fetchInboundAttachment({
      emailId: 'em_1',
      attachmentId: 'att_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes.length).toBe(4)
    expect(result.contentType).toBe('application/pdf')
    expect(capturedUrl).toBe('https://api.resend.com/emails/em_1/attachments/att_1')
    expect(capturedHeaders['Authorization']).toBe('Bearer test-key')
  })

  it('returns failure on non-2xx responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as never
    const result = await fetchInboundAttachment({ emailId: 'em_1', attachmentId: 'att_1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })
})
