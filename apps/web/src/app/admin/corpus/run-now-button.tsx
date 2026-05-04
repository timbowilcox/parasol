'use client'

// Client-side "Run now" button for the corpus admin sources table.
//
// Posts to /api/admin/corpus/sources/[id]/run; on 202 (queued), refreshes
// the page so the runs panel and the source's status pill update. The
// background ingestion runs out-of-band; the user re-clicks Run now or
// reloads to observe progress (DEF-049 streams runs into the UI for v1
// launch).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function RunNowButton({
  sourceId,
  sourceName,
  disabled,
}: {
  sourceId: string
  sourceName: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function trigger() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/admin/corpus/sources/${sourceId}/run`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = (body as { detail?: string; error?: string }).detail
          ?? (body as { error?: string }).error
          ?? `HTTP ${res.status}`
        setError(`Couldn't start ${sourceName}: ${detail}`)
        return
      }
      // Server has accepted the trigger and emitted the audit row; the
      // ingestion runs in the background. Refresh so the runs panel
      // reflects the new in-flight row.
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={trigger}
        disabled={disabled || pending}
      >
        {pending ? 'Starting…' : 'Run now'}
      </button>
      {error && (
        <div style={{ marginTop: 8, color: 'var(--critical-text)', fontSize: 12 }}>{error}</div>
      )}
    </>
  )
}
