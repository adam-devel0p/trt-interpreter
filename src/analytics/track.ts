import 'server-only';
import { platformDb } from '@/db/admin';
import { analyticsEvents } from '@/db/schema';
import {
  validateAnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
} from '@/domain/analytics/events';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Product analytics (FR-28, §16). `track()` is typed by the per-event allowlist, so a
 * journal field does not compile; at runtime the same schema rejects it and the event is
 * dropped with a content-free warning. Fire-and-forget: an analytics failure never fails
 * the action that emitted it. The row is written by the service role; the table has no
 * user policy.
 */
export function track<N extends AnalyticsEventName>(
  userId: string | null,
  name: N,
  props: AnalyticsProps<N>,
): void {
  void trackNow(userId, name, props).catch(() => {});
}

/** Awaitable variant for tests and jobs. Returns whether a row was written. */
export async function trackNow(
  userId: string | null,
  name: string,
  props: unknown,
): Promise<boolean> {
  const checked = validateAnalyticsEvent(name, props);
  if (!checked.ok) {
    logger.warn('app.analytics.rejected', { kind: name.slice(0, 64) });
    return false;
  }
  try {
    await platformDb()
      .insert(analyticsEvents)
      .values({ userId, name: checked.name, props: checked.props });
    return true;
  } catch (err) {
    logger.warn('app.analytics.write_failed', {
      kind: checked.name,
      errorClass: errorClassOf(err),
    });
    return false;
  }
}
