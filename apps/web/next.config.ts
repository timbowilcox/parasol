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
  // Vercel's serverless bundler traces .ts/.js imports automatically but
  // doesn't follow runtime fs.readFile calls into workspace packages. The
  // playbook loader (`packages/playbooks/src/loader.ts`) reads YAML files
  // from disk at request time, so we have to declare them as included
  // assets explicitly. Without this, the lambda bundle ships without the
  // playbook YAMLs and `loadPlaybook('kenya', 'nda')` throws
  // "playbook for kenya/nda not found" — surfaced by Tim's third live
  // forward (2026-05-06).
  outputFileTracingIncludes: {
    '/api/inbound/email': ['../../packages/playbooks/**/*.yaml'],
    '/api/upload': ['../../packages/playbooks/**/*.yaml'],
  },
}

export default withSentryConfig(nextConfig, {
  org: 'parasol',
  project: 'parasol-web',
  silent: !process.env.CI,
  telemetry: false,
})