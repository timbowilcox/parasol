import { describe, it, expect } from 'vitest'
import {
  scrubEmailAddresses,
  isSensitiveField,
  isDocumentContentField,
  scrubEvent,
  type ScrubbableEvent,
} from './pii-scrub.js'

describe('scrubEmailAddresses', () => {
  it('replaces a plain email address', () => {
    expect(scrubEmailAddresses('contact tim@parasol.co.ke today')).toBe(
      'contact [email] today',
    )
  })

  it('replaces multiple email addresses in one string', () => {
    const result = scrubEmailAddresses('from alice@example.com to bob@example.org')
    expect(result).toBe('from [email] to [email]')
  })

  it('leaves non-email strings unchanged', () => {
    expect(scrubEmailAddresses('no emails here')).toBe('no emails here')
  })

  it('handles emails at start and end of string', () => {
    expect(scrubEmailAddresses('alice@x.com hello world@y.com')).toBe(
      '[email] hello [email]',
    )
  })

  it('handles subdomains and plus-addressing', () => {
    expect(scrubEmailAddresses('test+alias@ask.parasol.co.ke')).toBe('[email]')
  })
})

describe('isSensitiveField', () => {
  it('matches password fields', () => {
    expect(isSensitiveField('password')).toBe(true)
    expect(isSensitiveField('passwordHash')).toBe(true)
    expect(isSensitiveField('PASSWORD')).toBe(true)
  })

  it('matches token fields', () => {
    expect(isSensitiveField('token')).toBe(true)
    expect(isSensitiveField('accessToken')).toBe(true)
    expect(isSensitiveField('RESEND_INBOUND_WEBHOOK_SECRET')).toBe(true)
  })

  it('matches api_key variations', () => {
    expect(isSensitiveField('api_key')).toBe(true)
    expect(isSensitiveField('apiKey')).toBe(true)
    expect(isSensitiveField('ANTHROPIC_API_KEY')).toBe(true)
  })

  it('does not match innocent fields', () => {
    expect(isSensitiveField('userId')).toBe(false)
    expect(isSensitiveField('workspaceName')).toBe(false)
    expect(isSensitiveField('status')).toBe(false)
  })
})

describe('isDocumentContentField', () => {
  it('matches document content field names', () => {
    expect(isDocumentContentField('full_text')).toBe(true)
    expect(isDocumentContentField('raw_text')).toBe(true)
    expect(isDocumentContentField('document_content')).toBe(true)
    expect(isDocumentContentField('content')).toBe(true)
    expect(isDocumentContentField('body')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isDocumentContentField('FULL_TEXT')).toBe(true)
    expect(isDocumentContentField('Body')).toBe(true)
  })

  it('does not match unrelated fields', () => {
    expect(isDocumentContentField('workspace_id')).toBe(false)
    expect(isDocumentContentField('severity')).toBe(false)
  })
})

describe('scrubEvent', () => {
  it('scrubs email in top-level message', () => {
    const event: ScrubbableEvent = { message: 'Error for user alice@example.com' }
    expect(scrubEvent(event).message).toBe('Error for user [email]')
  })

  it('scrubs email in exception value', () => {
    const event: ScrubbableEvent = {
      exception: {
        values: [{ value: 'Failed to send to bob@corp.com', type: 'Error' }],
      },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.exception?.values?.[0]?.value).toBe('Failed to send to [email]')
  })

  it('strips user PII but retains id', () => {
    const event: ScrubbableEvent = {
      user: { id: 'user-abc', email: 'tim@parasol.co.ke', ip_address: '1.2.3.4' },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.user).toEqual({ id: 'user-abc' })
  })

  it('redacts request body entirely', () => {
    const event: ScrubbableEvent = {
      request: { data: { contract_text: 'THIS IS CUSTOMER DOCUMENT' }, url: '/api/review' },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.request?.data).toBe('[redacted]')
  })

  it('scrubs sensitive request headers', () => {
    const event: ScrubbableEvent = {
      request: {
        headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
      },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.request?.headers?.['authorization']).toBe('[redacted]')
    expect(scrubbed.request?.headers?.['content-type']).toBe('application/json')
  })

  it('scrubs sensitive keys in extra context', () => {
    const event: ScrubbableEvent = {
      extra: {
        workspaceId: 'ws-123',
        apiKey: 'sk-voyage-secret',
        document_content: 'full NDA text here',
      },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.extra?.['workspaceId']).toBe('ws-123')
    expect(scrubbed.extra?.['apiKey']).toBe('[redacted]')
    expect(scrubbed.extra?.['document_content']).toBe('[redacted]')
  })

  it('scrubs email in extra string values', () => {
    const event: ScrubbableEvent = {
      extra: { senderEmail: 'alice@company.com', reviewId: 'rev-456' },
    }
    const scrubbed = scrubEvent(event)
    // senderEmail field name matches sensitive pattern → redacted entirely
    expect(scrubbed.extra?.['senderEmail']).toBe('[redacted]')
    expect(scrubbed.extra?.['reviewId']).toBe('rev-456')
  })

  it('scrubs nested extra objects', () => {
    const event: ScrubbableEvent = {
      extra: {
        metadata: {
          apiKey: 'sk-secret',
          name: 'Acme Corp',
        },
      },
    }
    const scrubbed = scrubEvent(event)
    const metadata = scrubbed.extra?.['metadata'] as Record<string, unknown>
    expect(metadata['apiKey']).toBe('[redacted]')
    expect(metadata['name']).toBe('Acme Corp')
  })

  it('does not mutate the original event', () => {
    const event: ScrubbableEvent = { message: 'contact alice@example.com' }
    scrubEvent(event)
    expect(event.message).toBe('contact alice@example.com')
  })

  it('handles event with no PII gracefully', () => {
    const event: ScrubbableEvent = {
      message: 'Database connection timeout',
      extra: { retryCount: 3, stage: 'compare-playbook' },
    }
    const scrubbed = scrubEvent(event)
    expect(scrubbed.message).toBe('Database connection timeout')
    expect(scrubbed.extra?.['retryCount']).toBe(3)
    expect(scrubbed.extra?.['stage']).toBe('compare-playbook')
  })
})
