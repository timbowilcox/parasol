import { describe, it, expect } from 'vitest'
import { Webhook } from 'svix'
import {
  verifyInboundWebhook,
  extractEmailAddress,
  extractDomain,
  isSenderAllowed,
  inboundEmailPayloadSchema,
} from './email-webhook.js'

// A real Svix-format secret. Must be base64-encoded random bytes; Svix's
// internal validation rejects anything else. Generated for tests only.
const TEST_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'

const samplePayload = {
  type: 'email.received',
  created_at: '2026-05-04T10:00:00.000Z',
  data: {
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    created_at: '2026-05-04T10:00:00.000Z',
    from: 'Counterparty <legal@example.com>',
    to: ['ask@parasol.co.ke'],
    cc: [],
    bcc: [],
    message_id: '<test+1@example.com>',
    subject: 'NDA for review',
    attachments: [
      { id: 'att-1', filename: 'nda.pdf', content_type: 'application/pdf' },
    ],
  },
} as const

// Helper: produce a valid Svix-signed request for the sample payload.
function signValid(payload: unknown, msgId = 'msg_test_1') {
  const wh = new Webhook(TEST_SECRET)
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = wh.sign(msgId, new Date(Number(timestamp) * 1000), body)
  return { body, headers: { id: msgId, timestamp, signature } }
}

// ─── Schema parsing ──────────────────────────────────────────────────────────

describe('inboundEmailPayloadSchema', () => {
  it('parses a valid email.received payload', () => {
    const r = inboundEmailPayloadSchema.parse(samplePayload)
    expect(r.data.subject).toBe('NDA for review')
    expect(r.data.attachments).toHaveLength(1)
  })
  it('defaults missing arrays to []', () => {
    const r = inboundEmailPayloadSchema.parse({
      type: 'email.received',
      created_at: '2026-05-04T10:00:00.000Z',
      data: {
        email_id: 'x',
        created_at: '2026-05-04T10:00:00.000Z',
        from: 'a@b.com',
        message_id: '<x>',
        subject: 's',
      },
    })
    expect(r.data.to).toEqual([])
    expect(r.data.cc).toEqual([])
    expect(r.data.attachments).toEqual([])
  })
  it('rejects a wrong type', () => {
    expect(
      inboundEmailPayloadSchema.safeParse({ ...samplePayload, type: 'email.delivered' }).success,
    ).toBe(false)
  })
})

// ─── verifyInboundWebhook ────────────────────────────────────────────────────

describe('verifyInboundWebhook', () => {
  it('returns ok with parsed payload for a valid signature', () => {
    const { body, headers } = signValid(samplePayload)
    const r = verifyInboundWebhook({ rawBody: body, headers, secret: TEST_SECRET })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.data.subject).toBe('NDA for review')
    }
  })

  it('returns missing_headers when any header is absent', () => {
    const { body, headers } = signValid(samplePayload)
    expect(verifyInboundWebhook({ rawBody: body, headers: { ...headers, id: undefined }, secret: TEST_SECRET }).ok).toBe(false)
    expect(verifyInboundWebhook({ rawBody: body, headers: { ...headers, timestamp: undefined }, secret: TEST_SECRET }).ok).toBe(false)
    expect(verifyInboundWebhook({ rawBody: body, headers: { ...headers, signature: undefined }, secret: TEST_SECRET }).ok).toBe(false)
  })

  it('returns bad_signature when payload bytes are altered', () => {
    const { body, headers } = signValid(samplePayload)
    const tampered = body.replace('NDA for review', 'NDA for HACK')
    const r = verifyInboundWebhook({ rawBody: tampered, headers, secret: TEST_SECRET })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('returns bad_signature when the wrong secret is used', () => {
    const { body, headers } = signValid(samplePayload)
    const r = verifyInboundWebhook({
      rawBody: body,
      headers,
      secret: 'whsec_DIFFERENT_SECRET_VALUE_123ABC',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('returns wrong_event_type for outbound events sent to the same URL', () => {
    const outbound = { ...samplePayload, type: 'email.delivered' as unknown as 'email.received' }
    const { body, headers } = signValid(outbound)
    const r = verifyInboundWebhook({ rawBody: body, headers, secret: TEST_SECRET })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrong_event_type')
  })

  it('returns malformed_payload when shape doesn\'t match', () => {
    const malformed = { type: 'email.received', created_at: '2026-05-04T10:00:00Z', data: { from: 'x' } }
    const { body, headers } = signValid(malformed)
    const r = verifyInboundWebhook({ rawBody: body, headers, secret: TEST_SECRET })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('malformed_payload')
  })
})

// ─── extractEmailAddress / extractDomain ────────────────────────────────────

describe('extractEmailAddress', () => {
  it('parses Name <email> form', () => {
    expect(extractEmailAddress('Counterparty <legal@example.com>')).toBe('legal@example.com')
  })
  it('parses bare email', () => {
    expect(extractEmailAddress('legal@example.com')).toBe('legal@example.com')
  })
  it('lowercases', () => {
    expect(extractEmailAddress('Legal@Example.COM')).toBe('legal@example.com')
  })
  it('returns null for non-email input', () => {
    expect(extractEmailAddress('not an email')).toBeNull()
    expect(extractEmailAddress('')).toBeNull()
  })
})

describe('extractDomain', () => {
  it('extracts the domain from an email', () => {
    expect(extractDomain('a@example.com')).toBe('example.com')
    expect(extractDomain('a@subsidiary.example.com')).toBe('subsidiary.example.com')
  })
  it('returns null on non-email', () => {
    expect(extractDomain('not-an-email')).toBeNull()
  })
})

// ─── isSenderAllowed ────────────────────────────────────────────────────────

describe('isSenderAllowed', () => {
  it('returns false for empty allowlist', () => {
    expect(isSenderAllowed('a@example.com', [])).toBe(false)
  })
  it('matches exact domain', () => {
    expect(isSenderAllowed('a@example.com', ['example.com'])).toBe(true)
  })
  it('matches subdomain of allowed domain', () => {
    expect(isSenderAllowed('a@subsidiary.example.com', ['example.com'])).toBe(true)
  })
  it('does not match unrelated domain that ends with same TLD', () => {
    expect(isSenderAllowed('a@evil.com', ['example.com'])).toBe(false)
  })
  it('does not match domain that contains allowed as a substring', () => {
    expect(isSenderAllowed('a@notexample.com', ['example.com'])).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(isSenderAllowed('a@EXAMPLE.COM', ['example.com'])).toBe(true)
    expect(isSenderAllowed('a@example.com', ['EXAMPLE.COM'])).toBe(true)
  })
  it('matches against any of multiple allowed domains', () => {
    expect(isSenderAllowed('a@acme.com', ['parasol.co.ke', 'acme.com', 'beta.io'])).toBe(true)
  })
  it('returns false when sender email lacks @', () => {
    expect(isSenderAllowed('not-an-email', ['example.com'])).toBe(false)
  })
})
