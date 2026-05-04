// GET /api/review/[id]/redline.docx — Streams the redlined Word document
// for a completed review back to the caller's browser.
//
// Sprint 1 stores the bytes inline as base64 on `reviews.redline_docx_base64`
// (migration 0007). v2 (DEF-048) migrates this to Supabase Storage with
// signed URLs; the route handler here will switch from "decode and stream"
// to "redirect to signed URL" without changing the URL surface.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'
import { ReviewRepository } from '@parasol/core'

type RouteParams = { id: string }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
  const { id } = await params
  await requireAuth()

  const supabase = await createServerClient()
  const reviews = new ReviewRepository(supabase)
  let review
  try {
    review = await reviews.getById(id)
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!review.redline_docx_base64) {
    return NextResponse.json(
      { error: 'redline_unavailable', detail: `review status is ${review.status}` },
      { status: 404 },
    )
  }

  const bytes = Buffer.from(review.redline_docx_base64, 'base64')
  const filename = (review.original_filename ?? 'contract').replace(/\.(docx?|pdf|txt)$/i, '') + '-redlined.docx'

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      // Audit-grade: this endpoint is one-shot per request; no caching.
      'Cache-Control': 'private, no-store',
    },
  })
}
