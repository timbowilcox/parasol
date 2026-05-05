// Resend outbound — thin wrapper around POST https://api.resend.com/emails.
//
// We intentionally don't pull in the `resend` SDK: a single fetch keeps the
// edge-runtime bundle small and matches the inbound webhook style (we rely on
// Svix directly for verification rather than the SDK helper).
//
// Caller responsibility: build the subject + html + text + attachments
// upstream from `assembleOutput`. This module only does the HTTP call.

export interface SendReplyInput {
  to: string                   // single recipient (the original sender's address)
  inReplyTo?: string           // RFC2822 Message-Id of the inbound — threads the reply
  subject: string
  text: string
  html: string
  attachments?: ReadonlyArray<{
    filename: string
    contentBase64: string      // already base64 — we forward verbatim
    contentType?: string       // optional; Resend infers from filename otherwise
  }>
}

export type SendReplyResult =
  | { ok: true; id: string }
  | { ok: false; status: number; detail: string }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    return { ok: false, status: 0, detail: 'RESEND_API_KEY not configured' }
  }

  const from = process.env['PARASOL_OUTBOUND_FROM'] ?? 'Parasol <hello@parasol.co.ke>'

  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    html: input.html,
  }
  if (input.inReplyTo) {
    // Both fields per RFC2822 + Resend convention. References lets clients
    // thread the conversation; in_reply_to is the immediate parent.
    body['headers'] = {
      'In-Reply-To': input.inReplyTo,
      References: input.inReplyTo,
    }
  }
  if (input.attachments && input.attachments.length > 0) {
    body['attachments'] = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
      ...(a.contentType ? { contentType: a.contentType } : {}),
    }))
  }

  let response: Response
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    return { ok: false, status: 0, detail: `network error: ${(cause as Error).message}` }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '<unreadable>')
    return { ok: false, status: response.status, detail }
  }

  const json = (await response.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: json.id ?? '' }
}

// ─── Inbound attachment fetch ────────────────────────────────────────────────
// Resend's webhook payload includes attachment IDs; the bytes themselves come
// from a separate authenticated GET. We use this to pull the contract bytes
// before handing them to extractPages.

export interface FetchAttachmentInput {
  emailId: string
  attachmentId: string
}

export type FetchAttachmentResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; status: number; detail: string }

export async function fetchInboundAttachment(input: FetchAttachmentInput): Promise<FetchAttachmentResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    return { ok: false, status: 0, detail: 'RESEND_API_KEY not configured' }
  }

  // Resend's inbound attachment retrieval lives under a different namespace
  // than outbound emails:
  //   GET /emails/receiving/{email_id}/attachments/{attachment_id}
  // Original v0.2 code hit /emails/{id}/attachments/{id} which is the
  // outbound namespace; an inbound email_id never resolves there and the
  // call returns 404 "Email not found". Surfaced by Tim's first live
  // forward (2026-05-05).
  //
  // The endpoint returns JSON metadata, not bytes. The actual download is a
  // presigned URL in `download_url` (no auth header required on the fetch;
  // expires at `expires_at`).
  const metadataUrl = `https://api.resend.com/emails/receiving/${encodeURIComponent(input.emailId)}/attachments/${encodeURIComponent(input.attachmentId)}`

  let metadataResponse: Response
  try {
    metadataResponse = await fetch(metadataUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (cause) {
    return { ok: false, status: 0, detail: `network error: ${(cause as Error).message}` }
  }

  if (!metadataResponse.ok) {
    const detail = await metadataResponse.text().catch(() => '<unreadable>')
    return { ok: false, status: metadataResponse.status, detail }
  }

  const metadata = (await metadataResponse.json().catch(() => null)) as
    | { download_url?: string; content_type?: string }
    | null
  if (!metadata?.download_url) {
    return {
      ok: false,
      status: metadataResponse.status,
      detail: 'attachment metadata missing download_url',
    }
  }

  // Stage 2: fetch the bytes from the presigned URL. No Authorization header —
  // the URL itself carries the signed credentials. Sending Bearer auth here
  // can confuse the storage backend on some signed-URL implementations.
  let bytesResponse: Response
  try {
    bytesResponse = await fetch(metadata.download_url, { method: 'GET' })
  } catch (cause) {
    return { ok: false, status: 0, detail: `download network error: ${(cause as Error).message}` }
  }
  if (!bytesResponse.ok) {
    const detail = await bytesResponse.text().catch(() => '<unreadable>')
    return { ok: false, status: bytesResponse.status, detail: `download failed: ${detail}` }
  }

  const buffer = await bytesResponse.arrayBuffer()
  return {
    ok: true,
    bytes: new Uint8Array(buffer),
    contentType: metadata.content_type
      ?? bytesResponse.headers.get('content-type')
      ?? 'application/octet-stream',
  }
}
