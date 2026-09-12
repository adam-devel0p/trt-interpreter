import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/observability/scrub';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // No session replay, ever (§11: no session-replay in the journal experience).
    integrations: [],
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
