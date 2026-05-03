// PII scrubbing utilities for error tracking (Sentry beforeSend hook).
// This module is framework-agnostic and fully testable without a Sentry account.
// The scrubbing logic is applied regardless of whether Sentry is configured.
//
// Scrubbing policy (per CLAUDE.md: "No PII in logs, ever"):
// - Email addresses in any string value → '[email]'
// - Field names matching sensitive patterns → '[redacted]' value
// - Document content fields → '[redacted]' (never log customer document text)

// Field names whose values must always be redacted.
// Patterns without ^ anchors catch compound names like accessToken, ANTHROPIC_API_KEY,
// senderEmail, RESEND_INBOUND_WEBHOOK_SECRET.
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /^auth/i,        // anchored: auth, authToken, authorization — avoids 'author', 'leather'
  /credential/i,
  /private[_-]?key/i,
  /email/i,        // email field values fully redacted; email addresses in other fields scrubbed
]

// Field names that may contain customer document content
const DOCUMENT_CONTENT_FIELDS = new Set([
  'document_content',
  'full_text',
  'raw_text',
  'contract_text',
  'extracted_text',
  'body',
  'content',
  'text',
  'page_text',
])

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g

export function scrubEmailAddresses(value: string): string {
  return value.replace(EMAIL_PATTERN, '[email]')
}

export function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))
}

export function isDocumentContentField(key: string): boolean {
  return DOCUMENT_CONTENT_FIELDS.has(key.toLowerCase())
}

function scrubValue(key: string, value: unknown): unknown {
  if (isSensitiveField(key) || isDocumentContentField(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    return scrubEmailAddresses(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? scrubEmailAddresses(item) : item))
  }
  return value
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = scrubObject(value as Record<string, unknown>)
    } else {
      result[key] = scrubValue(key, value)
    }
  }
  return result
}

// Minimal Sentry event shape — matches the fields we need to scrub
export interface ScrubbableEvent {
  message?: string
  extra?: Record<string, unknown>
  contexts?: Record<string, Record<string, unknown>>
  user?: Record<string, unknown>
  request?: {
    data?: unknown
    headers?: Record<string, string>
    [key: string]: unknown
  }
  exception?: {
    values?: Array<{
      value?: string
      [key: string]: unknown
    }>
  }
  [key: string]: unknown
}

export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
  const scrubbed: ScrubbableEvent = { ...event }

  // Scrub top-level message
  if (typeof scrubbed.message === 'string') {
    scrubbed.message = scrubEmailAddresses(scrubbed.message)
  }

  // Scrub exception values (error messages may contain PII)
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((v) => ({
        ...v,
        value: typeof v.value === 'string' ? scrubEmailAddresses(v.value) : v.value,
      })),
    }
  }

  // Scrub user object — keep id for correlation but remove email, name, ip_address
  if (scrubbed.user) {
    scrubbed.user = {
      id: scrubbed.user['id'],  // keep user id for incident correlation
    }
  }

  // Scrub request body and headers (may contain auth tokens or document payloads)
  if (scrubbed.request) {
    scrubbed.request = {
      ...scrubbed.request,
      data: '[redacted]',
      headers: scrubbed.request.headers
        ? Object.fromEntries(
            Object.entries(scrubbed.request.headers).map(([k, v]) => [
              k,
              isSensitiveField(k) ? '[redacted]' : scrubEmailAddresses(v),
            ]),
          )
        : undefined,
    }
  }

  // Scrub extra context (arbitrary key-value pairs attached by app code)
  if (scrubbed.extra) {
    scrubbed.extra = scrubObject(scrubbed.extra)
  }

  // Scrub contexts (Sentry-structured context blocks)
  if (scrubbed.contexts) {
    const scrubbedContexts: Record<string, Record<string, unknown>> = {}
    for (const [contextName, contextValue] of Object.entries(scrubbed.contexts)) {
      scrubbedContexts[contextName] = scrubObject(contextValue)
    }
    scrubbed.contexts = scrubbedContexts
  }

  return scrubbed
}
