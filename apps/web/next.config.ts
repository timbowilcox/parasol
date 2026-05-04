import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@parasol/core',
    '@parasol/ai',
    '@parasol/corpus',
    '@parasol/playbooks',
  ],
}

export default withSentryConfig(nextConfig, {
  org: 'parasol',
  project: 'parasol-web',
  silent: !process.env.CI,
  telemetry: false,
})