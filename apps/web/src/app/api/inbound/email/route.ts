// POST /api/inbound/email — Resend email.received webhook handler.
//
// Sprint 1 scope: verify Svix signature, route by recipient subdomain, check
// sender allowlist, create a 'pending' reviews row, then hand the heavy work
// off to processReview() via Vercel's waitUntil. The webhook handler itself
// returns 200 within ~1s; the orchestrator + reply send happen after the
// response is flushed but within the function's max-duration window.
//
// Per-workspace addressing: Sprint 1 uses a single fixed recipient
// `<anything>@ask.parasol.co.ke`; Sprint 3 expands to
// `ask@<workspace-slug>.parasol.co.ke` per DEF-002.

import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'
import {
  verifyInboundWebhook,
  extractEmailAddress,
  isSenderAllowed,
  classifyRecipients,
  pickContractAttachment,
} from '@/lib/inbound/email-webhook'
import { processReview } from '@/server/process-review'

// Vercel-allocated max duration. The whole pipeline must complete within this
// window or the function gets killed mid-run. 60s is the Sprint 1 p95 target;
// 120s is the upper bound while we measure (Day 13 narrows it back to 60).
// Bumped from 120 → 300 (Vercel Pro hard cap) after Tim's seventh live
// forward (2026-05-06). compare-playbook on Sonnet 4.6 ran 61s on a single
// real Mutual NDA + 5 sequential generate-redline calls at ~10s each =
// ~110s on stages 5-7 alone; total elapsed at function kill was ~113s on
// generate-redline #5. 300s gives headroom while DEF-049 streaming + a
// proper queue (DEF-018) and / or parallelising generate-redline lands.
export const maxDuration = 300

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

  // Route by recipient. The webhook URL receives mail for every parasol.co.ke
  // address (including the root domain Tim uses for human inboxes). Only
  // ask.parasol.co.ke triggers the contract intake pipeline.
  const classification = classifyRecipients(data.to)
  if (classification.kind === 'human_root') {
    // Human-addressed mail — out of v1 scope. Acknowledge and drop so Resend
    // doesn't retry. Sentry / observability captures these via console.info.
    console.info('inbound.ignored.human_root', {
      message_id: data.message_id,
      recipient_count: classification.recipients.length,
    })
    return NextResponse.json(
      { ignored: true, reason: 'human_addressed_root_domain' },
      { status: 200 },
    )
  }
  if (classification.kind === 'unexpected') {
    // Subdomain we don't recognise — possible misconfiguration or probe.
    // Warn so it surfaces in dashboards.
    console.warn('inbound.unexpected_subdomain', {
      message_id: data.message_id,
      recipient_domains: classification.recipients
        .map((r) => extractEmailAddress(r)?.split('@')[1])
        .filter((d): d is string => !!d),
    })
    return NextResponse.json(
      { ignored: true, reason: 'unexpected_subdomain' },
      { status: 200 },
    )
  }
  if (classification.kind === 'foreign') {
    // No parasol.co.ke recipients — shouldn't happen via Resend forwarding.
    console.warn('inbound.foreign_recipients', { message_id: data.message_id })
    return NextResponse.json(
      { ignored: true, reason: 'no_parasol_recipient' },
      { status: 200 },
    )
  }

  // classification.kind === 'intake' — proceed with the contract pipeline.
  const senderAddress = extractEmailAddress(data.from)
  if (!senderAddress) {
    return NextResponse.json({ error: 'unparseable_sender' }, { status: 400 })
  }

  // Resolve workspace. Sprint 1 fallback: the single shared dev workspace.
  // Once DEF-002 lands and per-workspace subdomains route through the wildcard
  // MX, parse the slug from `classification.intakeRecipient` and look it up.
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
      original_filename: pickContractAttachment(data)?.filename ?? null,
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

  // Hand off the orchestrator + reply send to run after the response flushes.
  // Vercel's `after()` keeps the function alive past the response boundary
  // (up to maxDuration). When self-hosting we'd want a real queue (DEF-018);
  // Sprint 1 ships on Vercel so this is sufficient.
  const contractAttachment = pickContractAttachment(data)
  after(async () => {
    try {
      await processReview({
        supabase,
        reviewId: review.id,
        workspaceId: workspace.id,
        attachment: {
          kind: 'email',
          inboundEmailId: data.email_id,
          attachmentId: contractAttachment?.id ?? null,
          filename: contractAttachment?.filename ?? null,
        },
        replyEmail: {
          replyTo: senderAddress,
          emailMessageId: data.message_id,
          originalSubject: data.subject,
        },
      })
    } catch (cause) {
      // processReview is supposed to swallow its own errors and return a
      // result; this catch is the last-resort guard for an unexpected throw
      // (e.g. a programming error in the helper itself).
      console.error('inbound.process_review_unhandled', {
        review_id: review.id,
        error: (cause as Error).message,
      })
    }
  })

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

