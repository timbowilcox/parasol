'use client'

// Client-side dropzone for the new-review upload page.
//
// Posts the selected file as multipart/form-data to /api/upload. On 200,
// the route handler returns { reviewId } and we navigate the user to
// /review/{reviewId} where they can poll for completion. Errors are
// shown inline; the upload is single-file (Sprint 1 — multi-file MSAs
// are deferred).

import { useState, useTransition, type DragEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — well above any NDA we expect

export function UploadDropzone() {
  const router = useRouter()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function validateAndUpload(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      // Some browsers return '' on .docx — fall through to extension check.
      const lowerName = file.name.toLowerCase()
      const okExt = lowerName.endsWith('.pdf') || lowerName.endsWith('.docx') || lowerName.endsWith('.txt')
      if (!okExt) {
        setError(`Unsupported file type: ${file.type || 'unknown'}. Use PDF, DOCX, or .txt.`)
        return
      }
    }
    if (file.size > MAX_BYTES) {
      setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB; maximum is 10 MB.`)
      return
    }
    setError(null)
    upload(file)
  }

  function upload(file: File) {
    const fd = new FormData()
    fd.append('file', file)

    startTransition(async () => {
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = (body as { detail?: string }).detail ?? `HTTP ${res.status}`
        setError(`Upload failed: ${detail}`)
        return
      }
      const json = (await res.json()) as { reviewId: string }
      router.push(`/review/${json.reviewId}`)
    })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) validateAndUpload(file)
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) validateAndUpload(file)
  }

  return (
    <>
      <div
        className={`dropzone ${dragOver ? 'dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {pending ? (
          <p>Uploading…</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>Drop a file here, or</p>
            <label htmlFor="upload-input">browse to choose one</label>
            <input
              id="upload-input"
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onChange}
            />
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 0 }}>
              PDF, DOCX, or plain text · up to 10 MB
            </p>
          </>
        )}
      </div>
      {error && (
        <div className="status-banner failed" style={{ marginTop: 16 }}>{error}</div>
      )}
    </>
  )
}
