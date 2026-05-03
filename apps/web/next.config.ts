import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default withSentryConfig(nextConfig, {
  org: 'parasol',
  project: 'parasol-web',
  // Upload source maps in CI only; suppress noise in local dev
  silent: !process.env.CI,
  // Don't block builds on missing SENTRY_AUTH_TOKEN (no auth token configured yet)
  telemetry: false,
})
