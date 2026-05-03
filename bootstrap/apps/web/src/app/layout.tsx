import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Parasol',
  description: 'AI legal copilot for in-house counsel and finance leaders across East Africa',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#1a1a1a',
          background: '#fafaf7',
        }}
      >
        {children}
      </body>
    </html>
  );
}
