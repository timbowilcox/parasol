// /login — Sprint 1 placeholder.
//
// Sign-in is not yet wired. ROADMAP.md schedules Supabase Auth (email magic
// link + Microsoft + Google OAuth) for Sprint 3 alongside workspace creation
// and billing. Tracked as DEF-050.
//
// The auth guards in @/server/auth (`requireAuth`, `requireAdmin`) redirect
// here when a session is missing. Until DEF-050 lands, the only Sprint 1
// surface a real user can exercise without operator-side database
// manipulation is the email pathway: forward an NDA to *@ask.parasol.co.ke.
//
// CLAUDE.md voice: honest about what's missing, specific about what does
// work, no fabricated remediation paths.

import Link from 'next/link'

export default function LoginPage() {
  return (
    <main className="page">
      <h1 className="page-title">Sign in</h1>
      <p className="page-subtitle">
        Web sign-in is not yet shipped. Supabase Auth lands in Sprint 3
        alongside workspace creation and billing (DEF-050).
      </p>
      <p>
        In the meantime, the email pathway is fully functional. Forward an
        NDA to any address at <span className="citation" style={{ textDecoration: 'none' }}>ask.parasol.co.ke</span>{' '}
        from a sender on the workspace allowlist; you should receive a
        redlined reply within a couple of minutes.
      </p>
      <p>
        <Link className="btn" href="/">Return home</Link>
      </p>
    </main>
  )
}
