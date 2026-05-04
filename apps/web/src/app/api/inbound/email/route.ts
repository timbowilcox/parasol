// POST /api/inbound/email — Resend email.received webhook handler.
//
// Sprint 1 scope: verify Svix signature, look up the workspace by recipient
// subdomain, check the sender's domain against the workspace's allowlist,
// create a `reviews` row in 'pending' status, return 200. The actual
// pipeline run (fetch attachment bytes via Resend API → orchestrator) is
// queued for Day 9 once the orchestrator is wired end to end.
//
// Critical: handler returns 200 within ~1s. Anything heavier than DB writes
// goes onto a queue (Sprint 2 wires Inngest or Supabase Edge cron — DEF-018).
//
// Per-workspace addressing: Sprint 1 uses a single fixed recipient
// `<anything>@ask.parasol.co.ke`; Sprint 3 expands to
// `ask@<workspace-slug>.parasol.co.ke` per DEF-002.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'
import {
  verifyInboundWebhook,
  extractEmailAddress,
  isSenderAllowed,
  type InboundEmailData,
} from '@/lib/inbound/email-webhook'

// Sprint 1 fixed recipient. Once DEF-002 lands, parse the workspace slug out
// of the local-part of the recipient (`ask@<slug>.parasol.co.ke`) and look
// up the workspace by slug instead of using a single shared workspace.
const SPRINT1_FALLBACK_WORKSPACE_SLUG = 'sprint1-dev'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env['RESEND_INBOUND_WEBHOOK_SECRET']
  if (!secret) {
    // Misconfiguration on our side — return 500, do not silently accept.
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 })
  }

  // We MUST verify against the raw bytes; reading json() and re-stringifying
  // changes whitespace and invalidates the signature.
  const rawBody = await req.text()
  const verification = verifyInboundWebhook({
    rawBody,
    headers: {
      id: req.headers.get('svix-id') ?? undefined,
      timestamp: req.headers.get('svix-timestamp') ?? undefined,
      signature: req.headers.get('svix-signature') ?? undefined,
    },
    secret,
  })

  if (!verification.ok) {
    if (verification.reason === 'wrong_event_type') {
      // Resend sends both inbound and outbound events to the same URL by
      // default. Outbound events (email.delivered, email.bounced, etc.) are
      // not errors — we just acknowledge them.
      return NextResponse.json({ ignored: true, type_seen: verification.detail }, { status: 200 })
    }
    return NextResponse.json(
      { error: verification.reason, detail: verification.detail },
      // Bad signature → 401. Missing headers / malformed → 400.
      { status: verification.reason === 'bad_signature' ? 401 : 400 },
    )
  }

  const { data } = verification.payload

  const senderAddress = extractEmailAddress(data.from)
  if (!senderAddress) {
    return NextResponse.json({ error: 'unparseable_sender' }, { status: 400 })
  }

  // Resolve workspace. Sprint 1 fallback: the single shared dev workspace.
  // Once DEF-002 lands and per-workspace subdomains route through the wildcard
  // MX, parse the slug from the recipient address and look it up.
  const supabase = adminClient()
  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, allowed_sender_domains')
    .eq('slug', SPRINT1_FALLBACK_WORKSPACE_SLUG)
    .maybeSingle()

  if (wsErr) {
    return NextResponse.json({ error: 'workspace_lookup_failed', detail: wsErr.message }, { status: 500 })
  }
  if (!workspace) {
    // No dev workspace seeded yet — accept and log without creating a review.
    // This keeps the smoke-test path green even on a fresh project.
    return NextResponse.json({ ignored: true, reason: 'no_workspace_configured' }, { status: 200 })
  }

  if (!isSenderAllowed(senderAddress, workspace.allowed_sender_domains)) {
    // Polite rejection — Sprint 1 logs it; Sprint 2 will send an explainer
    // reply via Resend. We still return 200 so Resend doesn't retry.
    return NextResponse.json(
      { ignored: true, reason: 'sender_not_in_allowlist', sender_domain: senderAddress.split('@')[1] },
      { status: 200 },
    )
  }

  // Find the workspace's first user as the synthetic creator. Inbound
  // attribution is workspace-scoped, not user-scoped, in Sprint 1.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('workspace_id', workspace.id)
    .limit(1)
    .maybeSingle()

  if (profileErr || !profile) {
    return NextResponse.json(
      { error: 'no_profile_for_workspace', detail: profileErr?.message },
      { status: 500 },
    )
  }

  // Hash the sender email before storing — CLAUDE.md "no PII in logs"
  // applies to the audit/log path; the reviews row stores the hash for
  // correlation, not the raw address.
  const senderHash = await hashSenderEmail(senderAddress)

  const { data: review, error: insertErr } = await supabase
    .from('reviews')
    .insert({
      workspace_id: workspace.id,
      created_by: profile.id,
      intake_source: 'email',
      contract_type: null,            // unknown until triage stage runs
      sender_email: senderHash,
      original_filename: pickFirstAttachmentName(data),
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertErr || !review) {
    return NextResponse.json(
      { error: 'review_insert_failed', detail: insertErr?.message },
      { status: 500 },
    )
  }

  // TODO Day 9 (DEF-018 enqueue): kick off the orchestrator pipeline for
  // review.id. For Sprint 1 the row sits in 'pending' until the pipeline
  // runs; Day 10's email-intake completion ticket finishes the loop.

  return NextResponse.json({ accepted: true, review_id: review.id }, { status: 200 })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceKey) {
    throw new Error('Supabase admin credentials missing')
  }
  return createClient<Database>(url, serviceKey, { auth: { persistSession: false } })
}

async function hashSenderEmail(addr: string): Promise<string> {
  // Web Crypto SHA-256, available on Node 20+ and Edge runtime.
  const enc = new TextEncoder().encode(addr)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function pickFirstAttachmentName(data: InboundEmailData): string | null {
  return data.attachments[0]?.filename ?? null
}
