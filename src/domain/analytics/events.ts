/**
 * Product analytics allowlist (FR-28, §16, §19 "no raw journal content in analytics").
 *
 * Every event has a strict Zod schema built only from the primitives below: closed enums,
 * booleans, bounded integers and uuids. **There is no string field**, so a question, a note,
 * a name or a title is not representable — the type checker rejects it (`track()` is typed
 * by these schemas) and `.strict()` rejects it at runtime. Adding a free-text prop is a
 * change to this file that the invariant test `no-journal-content-in-logs` fails.
 */
import { z } from 'zod';

const count = z.number().int().min(0).max(1_000_000);
const ms = z.number().int().min(0).max(3_600_000);
const deck = z.enum(['rws', 'thoth']);
const source = z.enum(['digital', 'physical']);
const objectType = z.enum(['reading', 'life_event']);
const feature = z.enum([
  'interpretation',
  'support',
  'memory',
  'ask_my_history',
  'correlation_explanations',
  'summaries',
]);
const reminderKind = z.enum(['revisit_due', 'weekly_reflection', 'monthly_retrospective']);
const channel = z.enum(['push', 'email']);
const interval = z.enum(['month', 'year']);
const shareKind = z.enum(['reading', 'month']);
const thumbs = z.enum(['up', 'down', 'cleared']);
/** Days since the entry, bucketed so the value is a class, not a date. */
const ageBucket = z.enum(['same_day', 'week', 'month', 'quarter', 'older']);

export const ANALYTICS_EVENTS = {
  // ── Activation (§16) ──────────────────────────────────────────────────────────────────
  reading_started: z.object({ source, deck }).strict(),
  reading_completed: z
    .object({ source, deck, cards: count, has_question: z.boolean(), first: z.boolean() })
    .strict(),
  interpretation_completed: z
    .object({ latency_ms: ms, first: z.boolean(), regenerated: z.boolean() })
    .strict(),
  // ── Early value ───────────────────────────────────────────────────────────────────────
  reading_reopened: z.object({ age: ageBucket }).strict(),
  journey_accepted: z.object({ suggested: z.boolean() }).strict(),
  journey_viewed: z.object({ members: count }).strict(),
  // ── Longitudinal value ────────────────────────────────────────────────────────────────
  life_event_logged: z.object({ about_reading: z.boolean(), with_photo: z.boolean() }).strict(),
  link_decided: z.object({ decision: z.enum(['confirmed', 'maybe', 'rejected']) }).strict(),
  outcome_recorded: z
    .object({
      status: z.enum(['happened', 'partly', 'did_not_happen', 'unresolved', 'irrelevant']),
    })
    .strict(),
  ask_asked: z
    .object({ scope: z.enum(['all', 'journey', 'entity', 'range']), sufficient: z.boolean() })
    .strict(),
  retrospective_viewed: z.object({ kind: z.enum(['weekly', 'monthly', 'yearly']) }).strict(),
  // ── AI quality ────────────────────────────────────────────────────────────────────────
  feedback_given: z
    .object({ target: z.enum(['interpretation', 'ask', 'summary']), thumbs })
    .strict(),
  metadata_corrected: z.object({ object_type: objectType }).strict(),
  entity_merged: z.object({ undone: z.boolean() }).strict(),
  entity_split: z.object({}).strict(),
  // ── Monetization ──────────────────────────────────────────────────────────────────────
  paywall_viewed: z.object({ feature, reason: z.enum(['plan', 'monthly', 'daily']) }).strict(),
  checkout_started: z.object({ interval, trial: z.boolean() }).strict(),
  trial_started: z.object({ interval: interval.nullable() }).strict(),
  subscription_converted: z.object({ interval: interval.nullable() }).strict(),
  subscription_renewed: z.object({ interval: interval.nullable() }).strict(),
  subscription_canceled: z.object({}).strict(),
  limit_reached: z.object({ feature, reason: z.enum(['plan', 'monthly', 'daily']) }).strict(),
  // ── Trust ─────────────────────────────────────────────────────────────────────────────
  export_requested: z.object({}).strict(),
  deletion_requested: z
    .object({ scope: z.enum(['reading', 'life_event', 'ai_artifacts', 'account']) })
    .strict(),
  privacy_page_viewed: z.object({}).strict(),
  // ── Retention & acquisition ───────────────────────────────────────────────────────────
  reminder_sent: z.object({ kind: reminderKind, channel }).strict(),
  reminder_opened: z.object({ kind: reminderKind }).strict(),
  reminder_unsubscribed: z
    .object({ kind: reminderKind, from: z.enum(['notification', 'profile']) })
    .strict(),
  share_card_rendered: z
    .object({
      kind: shareKind,
      question: z.boolean(),
      notes: z.boolean(),
      entities: z.boolean(),
    })
    .strict(),
  share_card_shared: z.object({ kind: shareKind, method: z.enum(['share', 'download']) }).strict(),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps<N extends AnalyticsEventName> = z.infer<(typeof ANALYTICS_EVENTS)[N]>;

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/** Validates one event; the only way a `(name, props)` pair becomes a row. */
export function validateAnalyticsEvent(
  name: string,
  props: unknown,
): { ok: true; name: AnalyticsEventName; props: Record<string, unknown> } | { ok: false } {
  if (!(name in ANALYTICS_EVENTS)) return { ok: false };
  const schema = ANALYTICS_EVENTS[name as AnalyticsEventName];
  const parsed = schema.safeParse(props ?? {});
  if (!parsed.success) return { ok: false };
  return { ok: true, name: name as AnalyticsEventName, props: parsed.data };
}

/** For the reopened-entry bucket. */
export function ageBucketOf(occurredAtIso: string, now = new Date()): z.infer<typeof ageBucket> {
  const days = Math.floor((now.getTime() - new Date(occurredAtIso).getTime()) / 86_400_000);
  if (days < 1) return 'same_day';
  if (days < 7) return 'week';
  if (days < 31) return 'month';
  if (days < 92) return 'quarter';
  return 'older';
}
