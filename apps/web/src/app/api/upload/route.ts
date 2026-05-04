// POST /api/upload — Web upload route handler.
//
// Day 11 surface for the dropzone at /review/new. Accepts a single
// multipart/form-data file, creates a 'pending' review row, and hands the
// bytes to processReview() via after() so the orchestrator runs after the
// response has flushed.
//
// Auth: requireAuth() resolves the workspace and creator from the user's
// Supabase session. RLS on the reviews table ensures the row insert is
// scoped to the caller's workspace.

import { NextResponse, type NextRequest, after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ReviewRepository } from '@parasol/core'
import { requireAuth } from '@/server/auth'
import { processReview } from '@/server/process-review'

// Same upper bound as Day 10's email path. Vercel hobby caps at 60s; the
// pipeline target is 60s p95 with 120s headroom while we measure.
export const maxDuration = 120

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — redirects to /login on missing session
  const user = await requireAuth()

  // 2. Parse multipart
  let form: FormData
  try {
    form = await req.formData()
  } catch (cause) {
    return NextResponse.json(
      { error: 'malformed_multipart', detail: (cause as Error).message },
      { status: 400 },
    )
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file', detail: 'expected a "file" field' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file', detail: 'file is empty' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', detail: `max ${MAX_BYTES} bytes` },
      { status: 413 },
    )
  }
  if (!ACCEPTED_TYPES.has(file.type) && !filenameIsAccepted(file.name)) {
    return NextResponse.json(
      { error: 'unsupported_type', detail: `received ${file.type || 'unknown'}; expected PDF, DOCX, or text` },
      { status: 415 },
    )
  }

  // 3. Read the bytes once — we both need them now (to hand off) and there
  // is no second read of the request body in serverless runtimes.
  const bytes = new Uint8Array(await file.arrayBuffer())

  // 4. Create the pending review row (RLS-scoped to the caller's workspace)
  const supabase = await createServerClient()
  const reviews = new ReviewRepository(supabase)
  const review = await reviews.create({
    workspaceId: user.workspaceId,
    createdBy: user.id,
    intakeSource: 'web',
    contractType: null,
    originalFilename: file.name,
  })

  // 5. Kick off processing after the response has flushed.
  // Use the filename-derived MIME type whenever the browser sent something
  // generic (octet-stream) — Windows + Edge frequently send octet-stream
  // for .docx, and the extract-pages helper is happier with a concrete type.
  const resolvedMime = file.type && file.type !== 'application/octet-stream'
    ? file.type
    : guessMimeFromName(file.name)
  after(async () => {
    try {
      await processReview({
        supabase,
        reviewId: review.id,
        workspaceId: user.workspaceId,
        attachment: {
          kind: 'inline',
          bytes,
          mimeType: resolvedMime,
          filename: file.name,
        },
      })
    } catch (cause) {
      console.error('upload.process_review_unhandled', {
        review_id: review.id,
        error: (cause as Error).message,
      })
    }
  })

  return NextResponse.json({ reviewId: review.id }, { status: 202 })
}

function filenameIsAccepted(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.txt')
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (lower.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}
