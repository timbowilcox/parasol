// Sentry server-side (Node.js) configuration.
// Initialisation is a no-op when SENTRY_DSN is not set (DEF-008 workaround).

import * as Sentry from '@sentry/nextjs'
import { scrubEvent, type ScrubbableEvent } from '@/lib/pii-scrub'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',

    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
    ],

    beforeSend(event) {
      // See sentry.client.config.ts for cast rationale
      // See sentry.client.config.ts for cast rationale
      return scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event
    },
  })
}
