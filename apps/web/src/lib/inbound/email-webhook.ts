// Inbound email webhook — Resend payload verification + parsing.
//
// Lives in src/lib/ rather than the route handler so it's framework-agnostic
// and unit-testable without spinning up a Next.js request. The route handler
// does only request → headers/body → call this → response.
//
// Critical: we MUST verify against the raw request body, not the JSON-parsed
// re-stringified version. The signature is byte-sensitive.

import { Webhook } from 'svix'
import { z } from 'zod'

// ─── Resend payload schema ──────────────────────────────────────────────────
// Source: https://resend.com/docs/webhooks/emails/received.md (Sprint 1).
// We only validate the fields we use; the schema is permissive on unknown
// fields so future Resend additions don't crash the handler.

export const inboundAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  content_disposition: z.string().optional(),
  content_id: z.string().optional(),
})

export const inboundEmailDataSchema = z.object({
  email_id: z.string(),
  created_at: z.string(),
  from: z.string(),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  message_id: z.string(),
  subject: z.string(),
  attachments: z.array(inboundAttachmentSchema).default([]),
})

export const inboundEmailPayloadSchema = z.object({
  type: z.literal('email.received'),
  created_at: z.string(),
  data: inboundEmailDataSchema,
})

export type InboundEmailPayload = z.infer<typeof inboundEmailPayloadSchema>
export type InboundEmailData = z.infer<typeof inboundEmailDataSchema>
export type InboundAttachment = z.infer<typeof inboundAttachmentSchema>

// ─── Verification ────────────────────────────────────────────────────────────

export interface VerifyOptions {
  rawBody: string                                    // exact bytes we received
  headers: { id?: string; timestamp?: string; signature?: string }
  secret: string
}

export type VerifyResult =
  | { ok: true; payload: InboundEmailPayload }
  | { ok: false; reason: 'missing_headers' | 'bad_signature' | 'malformed_payload' | 'wrong_event_type'; detail?: string }

export function verifyInboundWebhook(opts: VerifyOptions): VerifyResult {
  const { id, timestamp, signature } = opts.headers
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing_headers' }
  }
  let verifiedJson: unknown
  try {
    const wh = new Webhook(opts.secret)
    verifiedJson = wh.verify(opts.rawBody, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    })
  } catch (cause) {
    return { ok: false, reason: 'bad_signature', detail: (cause as Error).message }
  }

  // Accept only inbound events. Resend sends many event types to the same
  // webhook URL; we filter by `type` to ignore outbound events that may
  // share the endpoint.
  const typed = verifiedJson as { type?: unknown }
  if (typed.type !== 'email.received') {
    return { ok: false, reason: 'wrong_event_type', detail: String(typed.type) }
  }

  const parsed = inboundEmailPayloadSchema.safeParse(verifiedJson)
  if (!parsed.success) {
    return { ok: false, reason: 'malformed_payload', detail: parsed.error.message }
  }
  return { ok: true, payload: parsed.data }
}

// ─── Sender allowlist ───────────────────────────────────────────────────────

// Extract a normalised lowercase email address from a "Name <addr@domain>"
// or bare-address string. Returns null on inputs that don't contain an @.
export function extractEmailAddress(rawFrom: string): string | null {
  const angle = rawFrom.match(/<([^>]+)>/)
  const candidate = (angle?.[1] ?? rawFrom).trim().toLowerCase()
  return candidate.includes('@') ? candidate : null
}

export function extractDomain(emailAddress: string): string | null {
  const at = emailAddress.lastIndexOf('@')
  if (at < 0) return null
  return emailAddress.slice(at + 1)
}

// Returns true when the sender's domain (or any of its subdomain ancestors)
// appears in the workspace's allowed_sender_domains array.
//
// e.g. allowed_sender_domains = ['acme.com'] matches both 'a@acme.com' and
// 'b@subsidiary.acme.com'. Exact-domain matching only would lose subsidiaries
// and email aliases, both of which are common in our SME ICP.
export function isSenderAllowed(senderEmail: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return false
  const domain = extractDomain(senderEmail)
  if (!domain) return false
  const lower = domain.toLowerCase()
  return allowedDomains.some((allowed) => {
    const a = allowed.toLowerCase()
    return lower === a || lower.endsWith('.' + a)
  })
}
