import { describe, it, expect } from 'vitest'
import { Webhook } from 'svix'
import {
  verifyInboundWebhook,
  extractEmailAddress,
  extractDomain,
  isSenderAllowed,
  inboundEmailPayloadSchema,
  classifyRecipients,
  isAtIntakeSubdomain,
  isAtParasolDomain,
  pickContractAttachment,
  type InboundEmailData,
} from './email-webhook'

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

// ─── Recipient classification ───────────────────────────────────────────────

describe('isAtIntakeSubdomain', () => {
  it('matches addresses at ask.parasol.co.ke', () => {
    expect(isAtIntakeSubdomain('hello@ask.parasol.co.ke')).toBe(true)
    expect(isAtIntakeSubdomain('Counterparty <legal@ask.parasol.co.ke>')).toBe(true)
  })
  it('is case-insensitive on the domain', () => {
    expect(isAtIntakeSubdomain('hello@ASK.PARASOL.CO.KE')).toBe(true)
  })
  it('does not match the root parasol.co.ke', () => {
    expect(isAtIntakeSubdomain('tim@parasol.co.ke')).toBe(false)
  })
  it('does not match other subdomains', () => {
    expect(isAtIntakeSubdomain('hello@app.parasol.co.ke')).toBe(false)
    expect(isAtIntakeSubdomain('hello@billing.parasol.co.ke')).toBe(false)
  })
  it('does not match unrelated domains that contain the substring', () => {
    expect(isAtIntakeSubdomain('a@notask.parasol.co.ke')).toBe(false)
  })
})

describe('isAtParasolDomain', () => {
  it('matches root and any subdomain', () => {
    expect(isAtParasolDomain('a@parasol.co.ke')).toBe(true)
    expect(isAtParasolDomain('a@ask.parasol.co.ke')).toBe(true)
    expect(isAtParasolDomain('a@anything.parasol.co.ke')).toBe(true)
  })
  it('does not match unrelated domains', () => {
    expect(isAtParasolDomain('a@parasol.com')).toBe(false)
    expect(isAtParasolDomain('a@notparasol.co.ke')).toBe(false)
  })
})

describe('classifyRecipients', () => {
  it('classifies a single ask.parasol.co.ke recipient as intake', () => {
    const r = classifyRecipients(['hello@ask.parasol.co.ke'])
    expect(r.kind).toBe('intake')
    if (r.kind === 'intake') expect(r.intakeRecipient).toBe('hello@ask.parasol.co.ke')
  })

  it('classifies root parasol.co.ke recipients as human_root', () => {
    const r = classifyRecipients(['tim@parasol.co.ke', 'hello@parasol.co.ke'])
    expect(r.kind).toBe('human_root')
  })

  it('classifies unknown subdomains as unexpected', () => {
    const r = classifyRecipients(['x@billing.parasol.co.ke'])
    expect(r.kind).toBe('unexpected')
    if (r.kind === 'unexpected') {
      expect(r.recipients).toContain('x@billing.parasol.co.ke')
    }
  })

  it('classifies non-parasol-domain recipients as foreign', () => {
    const r = classifyRecipients(['a@example.com'])
    expect(r.kind).toBe('foreign')
  })

  it('intake wins when mixed with human_root recipients', () => {
    // A counterparty cc-ing ask@... and tim@... still triggers intake.
    const r = classifyRecipients(['hello@ask.parasol.co.ke', 'tim@parasol.co.ke'])
    expect(r.kind).toBe('intake')
  })

  it('intake wins when mixed with unexpected subdomain recipients', () => {
    const r = classifyRecipients(['hello@ask.parasol.co.ke', 'x@billing.parasol.co.ke'])
    expect(r.kind).toBe('intake')
  })

  it('unexpected wins over human_root when both present and no intake', () => {
    const r = classifyRecipients(['x@billing.parasol.co.ke', 'tim@parasol.co.ke'])
    expect(r.kind).toBe('unexpected')
    // Only the subdomained recipient lands in `recipients` for warning logs
    if (r.kind === 'unexpected') {
      expect(r.recipients).toEqual(['x@billing.parasol.co.ke'])
    }
  })

  it('handles Name <addr> form recipients', () => {
    const r = classifyRecipients(['"Parasol Intake" <hello@ask.parasol.co.ke>'])
    expect(r.kind).toBe('intake')
  })

  it('returns foreign for an empty to array', () => {
    expect(classifyRecipients([]).kind).toBe('foreign')
  })
})

// ─── pickContractAttachment ─────────────────────────────────────────────────

const buildData = (
  attachments: InboundEmailData['attachments'],
): InboundEmailData => ({
  email_id: 'em',
  created_at: '2026-05-05T11:26:21.000Z',
  from: 'tim.wilcox@live.com',
  to: ['ask@ask.parasol.co.ke'],
  cc: [],
  bcc: [],
  message_id: '<m@x>',
  subject: 'Fw:',
  attachments,
})

describe('pickContractAttachment', () => {
  it('returns null when there are no attachments', () => {
    expect(pickContractAttachment(buildData([]))).toBeNull()
  })

  it('returns the only attachment when there is exactly one (Sprint 1 fixture path)', () => {
    const sole = {
      id: 'a-1',
      filename: 'nda.pdf',
      content_type: 'application/pdf',
      content_disposition: 'attachment',
    }
    expect(pickContractAttachment(buildData([sole]))?.id).toBe('a-1')
  })

  it('skips inline Outlook signature images and picks the .docx — real-world Outlook forward payload', () => {
    // Recreated from the actual Resend payload Tim received forwarding from
    // Outlook on 2026-05-05. Five inline image attachments precede the actual
    // contract; the naive `attachments[0]` heuristic would feed the first
    // PNG to the orchestrator.
    const data = buildData([
      { id: '6f9dcd47', filename: 'Outlook-photo.png', content_type: 'image/png', content_disposition: 'inline' },
      { id: 'b106e4ba', filename: 'Outlook-icon.png', content_type: 'image/png', content_disposition: 'inline' },
      { id: 'c45d1005', filename: 'Outlook-icon.png', content_type: 'image/png', content_disposition: 'inline' },
      { id: 'ff3180b6', filename: 'Outlook-icon.png', content_type: 'image/png', content_disposition: 'inline' },
      { id: '20301459', filename: 'Outlook-icon.png', content_type: 'image/png', content_disposition: 'inline' },
      {
        id: '3170d491',
        filename: 'Mutual NDA.docx',
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content_disposition: 'attachment',
      },
    ])
    expect(pickContractAttachment(data)?.id).toBe('3170d491')
    expect(pickContractAttachment(data)?.filename).toBe('Mutual NDA.docx')
  })

  it('falls back to filename extension when MIME is generic application/octet-stream', () => {
    const data = buildData([
      { id: 'sig', filename: 'Outlook-icon.png', content_type: 'image/png', content_disposition: 'inline' },
      {
        id: 'doc',
        filename: 'contract.docx',
        content_type: 'application/octet-stream',
        content_disposition: 'attachment',
      },
    ])
    expect(pickContractAttachment(data)?.id).toBe('doc')
  })

  it('prefers content_disposition=attachment over inline when both are contract-shaped', () => {
    const data = buildData([
      // Some senders ship an inline preview PDF before the real attachment
      { id: 'inline-pdf', filename: 'preview.pdf', content_type: 'application/pdf', content_disposition: 'inline' },
      { id: 'real', filename: 'NDA.pdf', content_type: 'application/pdf', content_disposition: 'attachment' },
    ])
    expect(pickContractAttachment(data)?.id).toBe('real')
  })

  it('falls back to the first attachment when nothing matches any heuristic', () => {
    const data = buildData([
      { id: 'first', filename: 'mystery', content_type: 'application/x-unknown' },
      { id: 'second', filename: 'mystery2', content_type: 'application/x-unknown' },
    ])
    expect(pickContractAttachment(data)?.id).toBe('first')
  })

  it('handles missing content_disposition without throwing', () => {
    const data = buildData([
      { id: 'no-dispo', filename: 'NDA.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ])
    expect(pickContractAttachment(data)?.id).toBe('no-dispo')
  })
})
