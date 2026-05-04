// /review/new — Web upload surface for the Sprint 1 review pipeline.
//
// Server component: enforces auth via requireAuth (redirects to /login if
// no session). Renders the page chrome and embeds the client-side
// dropzone, which posts the file to /api/upload and navigates to
// /review/[id] on success.

import { requireAuth } from '@/server/auth'
import { UploadDropzone } from './dropzone'

export default async function NewReviewPage() {
  await requireAuth()

  return (
    <main className="page">
      <h1 className="page-title">New review</h1>
      <p className="page-subtitle">
        Upload an NDA in PDF, DOCX, or plain-text format. Sprint 1 supports
        Kenyan-jurisdiction NDAs only; documents triaged outside this
        scope return a brief explanation rather than a redline.
      </p>
      <UploadDropzone />
      <p className="page-subtitle" style={{ marginTop: 32, fontSize: 13 }}>
        The same pipeline runs for emails forwarded to{' '}
        <span className="citation" style={{ textDecoration: 'none' }}>*@ask.parasol.co.ke</span>.
      </p>
    </main>
  )
}
