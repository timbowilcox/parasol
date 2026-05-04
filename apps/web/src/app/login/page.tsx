// /login — Sprint 1 stub.
//
// Auth guards in @/server/auth redirect here when a session is missing.
// Real sign-in (Supabase Auth + email magic link / OAuth) is Sprint 2;
// for now this page documents the redirect target so the integration tests
// for requireAuth don't 404 in dev.

import Link from 'next/link'

export default function LoginPage() {
  return (
    <main className="page">
      <h1 className="page-title">Sign in</h1>
      <p className="page-subtitle">
        Authentication is on the Sprint 2 roadmap. For Sprint 1 dev work,
        seed a profile row directly via the admin scripts and visit the
        protected page in a session that already has a Supabase user id.
      </p>
      <p>
        <Link className="btn" href="/">Return home</Link>
      </p>
    </main>
  )
}
