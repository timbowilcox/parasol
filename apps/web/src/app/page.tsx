// Root marketing-style placeholder. Sprint 2 builds the actual marketing
// site at parasol.co.ke; the app shell here just orients dev users at
// /upload and /admin/corpus.

import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="page">
      <h1 className="page-title">Parasol</h1>
      <p className="page-subtitle">Kenyan-jurisdiction contract review.</p>
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 500 }}>Sprint 1 surfaces</h2>
        <ul style={{ marginBottom: 0 }}>
          <li><Link href="/review/new">Upload a contract for review</Link></li>
          <li><Link href="/admin/corpus">Corpus admin (parasol_admin only)</Link></li>
        </ul>
      </div>
    </main>
  )
}
