// Sentry client-side (browser) configuration.
// Initialisation is a no-op when NEXT_PUBLIC_SENTRY_DSN is not set (DEF-008 workaround).

import * as Sentry from '@sentry/nextjs'
import { scrubEvent, type ScrubbableEvent } from '@/lib/pii-scrub'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',

    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 0.5,
    replaysSessionSampleRate: 0,

    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,   // never record customer contract text
        blockAllMedia: true,
      }),
    ],

    beforeSend(event) {
      // scrubEvent works on our minimal ScrubbableEvent interface; the cast is safe
      // because ErrorEvent is structurally compatible for the properties we touch.
      // The returned object is a valid ErrorEvent — we only strip PII, never change shape.
      // Double cast: ScrubbableEvent and ErrorEvent don't structurally overlap enough
      // for a direct assertion, but the scrubbed object IS a valid ErrorEvent at runtime.
      return scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event
    },
  })
}
