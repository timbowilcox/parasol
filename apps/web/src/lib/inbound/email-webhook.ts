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
  // Resend sends `null` (not absent) for these on attachments that aren't
  // referenced inline. Zod's `.optional()` accepts only `undefined`, so a
  // raw `.optional()` here rejects the real payload. `.nullish()` accepts
  // both `null` and `undefined` and is the right defensive treatment for
  // any field a third-party webhook may serialise inconsistently.
  // Surfaced by the first live forward (2026-05-05): the contract DOCX has
  // `content_id: null`; the 5 inline Outlook signature PNGs have content_id
  // strings.
  content_disposition: z.string().nullish(),
  content_id: z.string().nullish(),
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

// ─── Recipient classification ───────────────────────────────────────────────
// The Resend webhook receives events for every parasol.co.ke address (root +
// every subdomain), because the MX record is set per-domain at the registrar
// and we point ask.parasol.co.ke at Resend. The handler must classify each
// inbound by the recipient and route accordingly.

export const PARASOL_ROOT_DOMAIN = 'parasol.co.ke'
export const INTAKE_SUBDOMAIN = 'ask.parasol.co.ke'

export type RecipientClassification =
  // At least one recipient at ask.parasol.co.ke (or any future intake
  // subdomain). Triggers the contract intake pipeline. Sprint 3 (DEF-002)
  // expands this to ask@<workspace-slug>.parasol.co.ke; the classifier
  // already accepts those because it does an endsWith check.
  | { kind: 'intake'; intakeRecipient: string }
  // Recipients only at the root parasol.co.ke (e.g. tim@parasol.co.ke,
  // hello@parasol.co.ke). Human-addressed mail; out of scope for v1. Log
  // and ignore.
  | { kind: 'human_root'; recipients: readonly string[] }
  // Recipients at a subdomain we don't recognise. Possible misconfiguration
  // (a new subdomain MX'd at Resend without a handler) or a probe. Log a
  // warning so it surfaces in operational dashboards.
  | { kind: 'unexpected'; recipients: readonly string[] }
  // No parasol.co.ke recipients at all — shouldn't normally happen because
  // Resend only delivers mail addressed to our domains. Treat as unexpected.
  | { kind: 'foreign'; recipients: readonly string[] }

// ─── Attachment picker ──────────────────────────────────────────────────────
// Real-world Outlook forwards routinely include 5-6 inline `Outlook-icon.png`
// / `Outlook-photo.png` attachments (the email signature graphics) before the
// actual document. A naive `attachments[0]` heuristic feeds those to the
// orchestrator instead of the contract.
//
// Selection order:
//   1. `content_disposition === 'attachment'` AND a contract-shaped MIME or
//      filename extension (.docx / .pdf / .txt)
//   2. any attachment with a contract-shaped MIME or filename extension
//   3. any attachment whose `content_disposition` is 'attachment'
//   4. fallback to the first attachment (preserves Sprint 1 behaviour on
//      payloads with no clear signal — e.g. test fixtures with one PDF)
//
// Returns null when the email has no attachments at all.
export function pickContractAttachment(data: InboundEmailData): InboundAttachment | null {
  const atts = data.attachments
  if (atts.length === 0) return null

  const isContractShaped = (a: InboundAttachment): boolean => {
    const mime = a.content_type.toLowerCase().split(';')[0]!.trim()
    if (mime === 'application/pdf') return true
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
    if (mime === 'text/plain') return true
    const lower = a.filename.toLowerCase()
    return lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.txt')
  }
  const isExplicitAttachment = (a: InboundAttachment): boolean => {
    return (a.content_disposition ?? '').toLowerCase() === 'attachment'
  }

  return atts.find((a) => isExplicitAttachment(a) && isContractShaped(a))
    ?? atts.find(isContractShaped)
    ?? atts.find(isExplicitAttachment)
    ?? atts[0]!
}

// Inspect a `data.to` array and decide where to route. Priority: intake
// wins over human_root wins over unexpected wins over foreign. So a single
// email cc'd to both intake@... and tim@... still triggers the pipeline.
export function classifyRecipients(to: readonly string[]): RecipientClassification {
  const intakeMatch = to.find((addr) => isAtIntakeSubdomain(addr))
  if (intakeMatch) {
    return { kind: 'intake', intakeRecipient: extractEmailAddress(intakeMatch) ?? intakeMatch }
  }

  const parasolDomainAddrs = to.filter((addr) => isAtParasolDomain(addr))
  if (parasolDomainAddrs.length === 0) {
    return { kind: 'foreign', recipients: to }
  }

  // Among the parasol-domain recipients, are any on a non-intake subdomain?
  const subdomained = parasolDomainAddrs.filter((addr) => {
    const domain = extractDomain(extractEmailAddress(addr) ?? addr)
    return domain !== null && domain.toLowerCase() !== PARASOL_ROOT_DOMAIN
  })
  if (subdomained.length > 0) {
    return { kind: 'unexpected', recipients: subdomained }
  }

  return { kind: 'human_root', recipients: parasolDomainAddrs }
}

// Returns true if `addr` is at the intake subdomain `ask.parasol.co.ke`.
// Sprint 1 only handles this single fixed subdomain; the workspace-prefixed
// pattern `ask@<slug>.parasol.co.ke` is added in Sprint 3 (DEF-002).
export function isAtIntakeSubdomain(addr: string): boolean {
  const email = extractEmailAddress(addr)
  if (!email) return false
  const domain = extractDomain(email)
  if (!domain) return false
  return domain.toLowerCase() === INTAKE_SUBDOMAIN
}

export function isAtParasolDomain(addr: string): boolean {
  const email = extractEmailAddress(addr)
  if (!email) return false
  const domain = extractDomain(email)
  if (!domain) return false
  const lower = domain.toLowerCase()
  return lower === PARASOL_ROOT_DOMAIN || lower.endsWith('.' + PARASOL_ROOT_DOMAIN)
}
