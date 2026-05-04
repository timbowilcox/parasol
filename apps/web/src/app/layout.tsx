// Root layout for the Parasol web app.
//
// Brand alignment per BRAND.md:
// - Background tertiary (#F1EFE8) is the page background
// - Sentence case throughout
// - Sans (Inter) for body, serif (Source Serif 4) for page titles
// - Two weights only: 400 / 500
// - No decorative amber — amber is the brand mark only

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Parasol',
  description: 'Kenyan-jurisdiction contract review for in-house counsel.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
