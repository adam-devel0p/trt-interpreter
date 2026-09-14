/**
 * Life events, outcomes and links through the RLS-respecting user client (Phase 08, spec
 * §6.4, §8.2, FR-11–FR-15). Nothing here talks to a model: an event is saved in one insert
 * before any job runs; a link's state changes are one update each; the connection review
 * and the journey's sections render stored rows. Rule-side writes (scores, explanations)
 * come from `src/correlation/` with the service role.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { bandFor, type DisplayBand, type Signals } from '@/domain/correlation/score';
import { createEventInputSchema, type CreateEventInput } from '@/domain/events/types';
import {
  OUTCOME_NOTE_MAX,
  OUTCOME_STATUSES,
  syncedFollowUp,
  type OutcomeStatus,
} from '@/domain/outcomes/followUp';
import type { FollowUpStatus } from '@/domain/readings/types';
import { setFollowUpStatus, setRevisitAt } from './readings';

export class EventQueryError extends Error {
  override name = 'EventQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const fail = (what: string, error: { code?: string } | null): never => {
  throw new EventQueryError(`${what} failed`, error?.code);
};

// ── Events ─────────────────────────────────────────────────────────────────────────────────

export interface EventMediaView {
  id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string | null;
}

export interface EventRow {
  id: string;
  description: string;
  occurred_on: string;
  note: string | null;
  reading_id: string | null;
  event_type: string | null;
  importance: number | null;
  emotional_tone: string | null;
  life_area: string | null;
  fact_status: 'CONFIRMED_FACT' | 'INFERRED_EVENT';
  source: 'user' | 'model';
  correlated_at: string | null;
  created_at: string;
}

export interface EventView extends EventRow {
  media: EventMediaView[];
  /** The reading the user named when logging it, if any (and not since deleted). */
  origin: {
    id: string;
    question: string | null;
    is_open_reflection: boolean;
    occurred_at: string;
  } | null;
}

const EVENT_COLUMNS =
  'id, description, occurred_on, note, reading_id, event_type, importance, emotional_tone, life_area, ' +
  'fact_status, source, correlated_at, created_at';

/** Save the sentence. One insert; the origin link (if any) is a second, user-confirmed row. */
export async function createEvent(
  client: UserClient,
  userId: string,
  input: CreateEventInput,
): Promise<string> {
  const clean = createEventInputSchema.parse(input);
  const { data, error } = await client
    .from('life_events')
    .insert({
      user_id: userId,
      description: clean.description,
      occurred_on: clean.occurred_on,
      note: clean.note,
      reading_id: clean.reading_id,
    })
    .select('id')
    .single();
  if (error) fail('event create', error);
  const id = (data as { id: string }).id;
  if (clean.reading_id) {
    const link = await client.from('links').insert({
      user_id: userId,
      from_type: 'reading',
      from_id: clean.reading_id,
      to_type: 'life_event',
      to_id: id,
      link_type: 'reading_event',
      score: 1,
      reasons: ['You logged this against the reading'],
      created_by: 'user',
      state: 'confirmed',
      user_acted_at: new Date().toISOString(),
      evidence_fingerprint: 'user',
      offered_at: new Date().toISOString(),
    });
    if (link.error) fail('origin link', link.error);
  }
  return id;
}

export async function getEvent(client: UserClient, id: string): Promise<EventView | null> {
  const { data, error } = await client
    .from('life_events')
    .select(
      `${EVENT_COLUMNS}, event_media(id, storage_path, mime_type, size_bytes, alt_text), ` +
        'readings(id, question, is_open_reflection, occurred_at, deleted_at)',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) fail('event read', error);
  if (!data) return null;
  const raw = data as unknown as EventRow & {
    event_media: EventMediaView[] | null;
    readings: {
      id: string;
      question: string | null;
      is_open_reflection: boolean;
      occurred_at: string;
      deleted_at: string | null;
    } | null;
  };
  const { event_media, readings: origin, ...row } = raw;
  return {
    ...row,
    media: event_media ?? [],
    origin:
      origin && !origin.deleted_at
        ? {
            id: origin.id,
            question: origin.question,
            is_open_reflection: origin.is_open_reflection,
            occurred_at: origin.occurred_at,
          }
        : null,
  };
}

export interface EventListItem extends EventRow {
  /** Confirmed links to readings. */
  confirmed_links: number;
  media_count: number;
}

/** Newest first, live rows only. */
export async function listEvents(
  client: UserClient,
  opts: { limit?: number } = {},
): Promise<EventListItem[]> {
  const { data, error } = await client
    .from('life_events')
    .select(`${EVENT_COLUMNS}, event_media(id)`)
    .is('deleted_at', null)
    .order('occurred_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) fail('events read', error);
  const rows = (data ?? []) as unknown as (EventRow & { event_media: { id: string }[] | null })[];
  if (rows.length === 0) return [];
  const { data: confirmed, error: linkErr } = await client
    .from('links')
    .select('to_id')
    .eq('to_type', 'life_event')
    .eq('state', 'confirmed')
    .in(
      'to_id',
      rows.map((r) => r.id),
    );
  if (linkErr) fail('event links read', linkErr);
  const counts = new Map<string, number>();
  for (const l of (confirmed ?? []) as { to_id: string }[])
    counts.set(l.to_id, (counts.get(l.to_id) ?? 0) + 1);
  return rows.map(({ event_media, ...r }) => ({
    ...r,
    confirmed_links: counts.get(r.id) ?? 0,
    media_count: event_media?.length ?? 0,
  }));
}

/** Compact rows for pickers ("link an existing event"), newest first. */
export async function listEventOptions(
  client: UserClient,
  limit = 50,
): Promise<{ id: string; description: string; occurred_on: string }[]> {
  const { data, error } = await client
    .from('life_events')
    .select('id, description, occurred_on')
    .is('deleted_at', null)
    .order('occurred_on', { ascending: false })
    .limit(limit);
  if (error) fail('event options read', error);
  return (data ?? []) as { id: string; description: string; occurred_on: string }[];
}

export async function countEvents(client: UserClient): Promise<number> {
  const { count, error } = await client
    .from('life_events')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (error) fail('event count', error);
  return count ?? 0;
}

/** The date is the one thing about an event that may be corrected; the words never are. */
export async function setEventDate(
  client: UserClient,
  id: string,
  occurredOn: string,
): Promise<void> {
  const occurred_on = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(occurredOn);
  const { data, error } = await client
    .from('life_events')
    .update({ occurred_on })
    .eq('id', id)
    .select('id');
  if (error) fail('event date update', error);
  if (!data?.length) fail('event date update', { code: 'P0002' });
}

/** Soft delete: out of every view at once; the purge job hard-deletes. */
export async function softDeleteEvent(client: UserClient, id: string): Promise<boolean> {
  const { data, error } = await client
    .from('life_events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');
  if (error) fail('event delete', error);
  return (data?.length ?? 0) > 0;
}

export async function addEventMedia(
  client: UserClient,
  row: {
    userId: string;
    eventId: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    altText: string | null;
  },
): Promise<string> {
  const { data, error } = await client
    .from('event_media')
    .insert({
      user_id: row.userId,
      life_event_id: row.eventId,
      storage_path: row.storagePath,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      alt_text: row.altText,
    })
    .select('id')
    .single();
  if (error) fail('event media insert', error);
  return (data as { id: string }).id;
}

/** The owner's media row (RLS-checked) — the caller mints the signed URL from its path. */
export async function getEventMedia(
  client: UserClient,
  mediaId: string,
): Promise<EventMediaView | null> {
  const { data, error } = await client
    .from('event_media')
    .select('id, storage_path, mime_type, size_bytes, alt_text')
    .eq('id', mediaId)
    .maybeSingle();
  if (error) fail('event media read', error);
  return (data as EventMediaView | null) ?? null;
}

// ── Outcomes ───────────────────────────────────────────────────────────────────────────────

export interface OutcomeView {
  id: string;
  reading_id: string;
  prediction_id: string | null;
  life_event_id: string | null;
  status: OutcomeStatus;
  note: string | null;
  user_confirmed_at: string;
  created_at: string;
  event: { id: string; description: string; occurred_on: string } | null;
}

const OUTCOME_SELECT =
  'id, reading_id, prediction_id, life_event_id, status, note, user_confirmed_at, created_at, ' +
  'life_events(id, description, occurred_on, deleted_at)';

type RawOutcome = Omit<OutcomeView, 'event'> & {
  life_events: {
    id: string;
    description: string;
    occurred_on: string;
    deleted_at: string | null;
  } | null;
};

function toOutcome(raw: RawOutcome): OutcomeView {
  const { life_events, ...row } = raw;
  return {
    ...row,
    event:
      life_events && !life_events.deleted_at
        ? {
            id: life_events.id,
            description: life_events.description,
            occurred_on: life_events.occurred_on,
          }
        : null,
  };
}

/** Every outcome of a reading, newest first. */
export async function listReadingOutcomes(
  client: UserClient,
  readingId: string,
): Promise<OutcomeView[]> {
  const { data, error } = await client
    .from('outcomes')
    .select(OUTCOME_SELECT)
    .eq('reading_id', readingId)
    .order('created_at', { ascending: false });
  if (error) fail('outcomes read', error);
  return ((data ?? []) as unknown as RawOutcome[]).map(toOutcome);
}

/** Outcomes of a set of readings (a journey's), newest first. */
export async function listOutcomesForReadings(
  client: UserClient,
  readingIds: readonly string[],
): Promise<OutcomeView[]> {
  if (readingIds.length === 0) return [];
  const { data, error } = await client
    .from('outcomes')
    .select(OUTCOME_SELECT)
    .in('reading_id', [...readingIds])
    .order('created_at', { ascending: false });
  if (error) fail('outcomes read', error);
  return ((data ?? []) as unknown as RawOutcome[]).map(toOutcome);
}

/** Newest per target: the reading itself and each possibility. */
export function currentOutcomes(all: readonly OutcomeView[]): {
  reading: OutcomeView | null;
  byPrediction: Map<string, OutcomeView>;
} {
  let reading: OutcomeView | null = null;
  const byPrediction = new Map<string, OutcomeView>();
  for (const o of all) {
    if (o.prediction_id === null) reading ??= o;
    else if (!byPrediction.has(o.prediction_id)) byPrediction.set(o.prediction_id, o);
  }
  return { reading, byPrediction };
}

export const recordOutcomeInputSchema = z
  .object({
    readingId: z.string().uuid(),
    predictionId: z.string().uuid().nullable().default(null),
    lifeEventId: z.string().uuid().nullable().default(null),
    status: z.enum(OUTCOME_STATUSES),
    note: z.string().trim().max(OUTCOME_NOTE_MAX).nullable().default(null),
  })
  .strict();
export type RecordOutcomeInput = z.infer<typeof recordOutcomeInputSchema>;

/**
 * Record what happened (FR-15) as the user, then keep `follow_up_status` in step and clear
 * the revisit date — the question the reminder asked has been answered. Append-only.
 */
export async function recordOutcome(
  client: UserClient,
  userId: string,
  input: RecordOutcomeInput,
  opts: { openPredictionIds?: readonly string[] } = {},
): Promise<{ id: string; followUp: FollowUpStatus | null }> {
  const clean = recordOutcomeInputSchema.parse(input);
  const { data, error } = await client
    .from('outcomes')
    .insert({
      user_id: userId,
      reading_id: clean.readingId,
      prediction_id: clean.predictionId,
      life_event_id: clean.lifeEventId,
      status: clean.status,
      note: clean.note || null,
    })
    .select('id')
    .single();
  if (error) fail('outcome insert', error);
  const id = (data as { id: string }).id;

  const current = currentOutcomes(await listReadingOutcomes(client, clean.readingId));
  const open = opts.openPredictionIds ?? [...current.byPrediction.keys()];
  const followUp = syncedFollowUp({
    reading: current.reading?.status ?? null,
    possibilities: open.map((pid) => ({
      predictionId: pid,
      status: current.byPrediction.get(pid)?.status ?? null,
    })),
  });
  if (followUp) await setFollowUpStatus(client, clean.readingId, followUp);
  await setRevisitAt(client, clean.readingId, null);
  return { id, followUp };
}

/** Readings whose revisit date has passed and are still open (Home, "what happened?"). */
export async function listDueRevisits(
  client: UserClient,
  opts: { now?: Date; limit?: number } = {},
): Promise<
  {
    id: string;
    question: string | null;
    is_open_reflection: boolean;
    occurred_at: string;
    revisit_at: string;
    deck: { name: string; system: 'rws' | 'thoth' };
  }[]
> {
  const now = (opts.now ?? new Date()).toISOString();
  const { data, error } = await client
    .from('readings')
    .select('id, question, is_open_reflection, occurred_at, revisit_at, decks(name, system)')
    .is('deleted_at', null)
    .not('revisit_at', 'is', null)
    .lte('revisit_at', now)
    .in('follow_up_status', ['unresolved', 'partly_resolved'])
    .order('revisit_at', { ascending: true })
    .limit(opts.limit ?? 3);
  if (error) fail('due revisits read', error);
  return (
    (data ?? []) as unknown as {
      id: string;
      question: string | null;
      is_open_reflection: boolean;
      occurred_at: string;
      revisit_at: string;
      decks: { name: string; system: 'rws' | 'thoth' };
    }[]
  ).map(({ decks, ...r }) => ({ ...r, deck: decks }));
}

// ── Links ──────────────────────────────────────────────────────────────────────────────────

export type LinkState = 'pending' | 'confirmed' | 'maybe' | 'rejected';

export interface LinkView {
  id: string;
  from_type: 'reading' | 'life_event';
  from_id: string;
  to_type: 'reading' | 'life_event';
  to_id: string;
  link_type: string;
  /** The computed score (a confirmed link counts as 1 everywhere it is used as evidence). */
  score: number;
  band: DisplayBand | 'confirmed' | 'maybe' | 'rejected';
  signals: Signals | null;
  reasons: string[];
  explanation: string | null;
  created_by: 'user' | 'rule';
  state: LinkState;
  user_acted_at: string | null;
  offered_at: string | null;
  created_at: string;
}

const LINK_COLUMNS =
  'id, from_type, from_id, to_type, to_id, link_type, score, signals, reasons, explanation, created_by, ' +
  'state, user_acted_at, offered_at, created_at';

function toLink(raw: Record<string, unknown>): LinkView {
  const state = raw.state as LinkState;
  const score = Number(raw.score);
  return {
    ...(raw as unknown as LinkView),
    score,
    reasons: (raw.reasons as string[] | null) ?? [],
    band: state === 'pending' ? bandFor(score, raw.signals as Signals | null) : state,
  };
}

/**
 * Links on one object for its screen: offered suggestions (pending, visible band), the
 * user's confirmed and maybe links, and — for "you said no" — rejected ones. Hidden,
 * never-offered pending rows stay out of every view.
 */
export async function listLinksForObject(
  client: UserClient,
  object: { type: 'reading' | 'life_event'; id: string },
): Promise<LinkView[]> {
  const column = object.type === 'reading' ? 'from_id' : 'to_id';
  const { data, error } = await client
    .from('links')
    .select(LINK_COLUMNS)
    .eq(column, object.id)
    .eq(object.type === 'reading' ? 'from_type' : 'to_type', object.type)
    .order('score', { ascending: false });
  if (error) fail('links read', error);
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(toLink)
    .filter((l) => l.state !== 'pending' || (l.offered_at && l.band !== 'hidden'));
}

/** Links touching any of the given readings or events (a journey's connections). */
export async function listLinksForObjects(
  client: UserClient,
  ids: { readings: readonly string[]; events: readonly string[] },
): Promise<LinkView[]> {
  if (ids.readings.length === 0 && ids.events.length === 0) return [];
  const filters: string[] = [];
  if (ids.readings.length) filters.push(`from_id.in.(${ids.readings.join(',')})`);
  if (ids.events.length) filters.push(`to_id.in.(${ids.events.join(',')})`);
  const { data, error } = await client
    .from('links')
    .select(LINK_COLUMNS)
    .or(filters.join(','))
    .neq('state', 'rejected')
    .order('score', { ascending: false });
  if (error) fail('journey links read', error);
  const seen = new Set<string>();
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(toLink)
    .filter((l) => l.state !== 'pending' || (l.offered_at && l.band !== 'hidden'))
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

export const LINK_ACTIONS = ['confirmed', 'maybe', 'rejected'] as const;
export type LinkAction = (typeof LINK_ACTIONS)[number];

/** Confirm · Maybe · Unrelated — one update, as the user. A rejection remembers its evidence (§19). */
export async function actOnLink(
  client: UserClient,
  id: string,
  action: LinkAction,
): Promise<LinkView> {
  const state = z.enum(LINK_ACTIONS).parse(action);
  const { data: before, error: readErr } = await client
    .from('links')
    .select('score, evidence_fingerprint')
    .eq('id', id)
    .maybeSingle();
  if (readErr) fail('link read', readErr);
  if (!before) fail('link read', { code: 'P0002' });
  const prior = before as { score: string | number; evidence_fingerprint: string };
  const patch: Record<string, unknown> = {
    state,
    user_acted_at: new Date().toISOString(),
  };
  if (state === 'rejected') {
    patch.rejected_score = Number(prior.score);
    patch.rejected_fingerprint = prior.evidence_fingerprint;
  }
  const { data, error } = await client
    .from('links')
    .update(patch)
    .eq('id', id)
    .select(LINK_COLUMNS)
    .single();
  if (error) fail('link update', error);
  return toLink(data as unknown as Record<string, unknown>);
}

/** Undo the last decision: back to an offered suggestion. */
export async function undoLinkAction(client: UserClient, id: string): Promise<LinkView> {
  const { data, error } = await client
    .from('links')
    .update({
      state: 'pending',
      user_acted_at: null,
      rejected_score: null,
      rejected_fingerprint: null,
      offered_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('created_by', 'rule')
    .select(LINK_COLUMNS)
    .single();
  if (error) fail('link undo', error);
  return toLink(data as unknown as Record<string, unknown>);
}

/** Summaries of the other side of a set of links, for rendering. */
export interface LinkedReading {
  id: string;
  question: string | null;
  is_open_reflection: boolean;
  occurred_at: string;
  deck: { name: string; system: 'rws' | 'thoth' };
  spread: { name: string };
  cards: { name: string; orientation: 'upright' | 'reversed' }[];
}
export interface LinkedEvent {
  id: string;
  description: string;
  occurred_on: string;
}

export async function loadLinkedObjects(
  client: UserClient,
  links: readonly LinkView[],
): Promise<{ readings: Map<string, LinkedReading>; events: Map<string, LinkedEvent> }> {
  const readingIds = [
    ...new Set(links.filter((l) => l.from_type === 'reading').map((l) => l.from_id)),
  ];
  const eventIds = [
    ...new Set(links.filter((l) => l.to_type === 'life_event').map((l) => l.to_id)),
  ];
  const readings = new Map<string, LinkedReading>();
  const events = new Map<string, LinkedEvent>();
  const [r, e] = await Promise.all([
    readingIds.length
      ? client
          .from('readings')
          .select(
            'id, question, is_open_reflection, occurred_at, decks(name, system), spreads(name), reading_cards(position_index, orientation, cards(name))',
          )
          .in('id', readingIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? client
          .from('life_events')
          .select('id, description, occurred_on')
          .in('id', eventIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (r.error) fail('linked readings read', r.error);
  if (e.error) fail('linked events read', e.error);
  for (const raw of (r.data ?? []) as unknown as {
    id: string;
    question: string | null;
    is_open_reflection: boolean;
    occurred_at: string;
    decks: { name: string; system: 'rws' | 'thoth' };
    spreads: { name: string };
    reading_cards: {
      position_index: number;
      orientation: 'upright' | 'reversed';
      cards: { name: string };
    }[];
  }[]) {
    readings.set(raw.id, {
      id: raw.id,
      question: raw.question,
      is_open_reflection: raw.is_open_reflection,
      occurred_at: raw.occurred_at,
      deck: raw.decks,
      spread: raw.spreads,
      cards: raw.reading_cards
        .slice()
        .sort((a, b) => a.position_index - b.position_index)
        .map((c) => ({ name: c.cards.name, orientation: c.orientation })),
    });
  }
  for (const raw of (e.data ?? []) as LinkedEvent[]) events.set(raw.id, raw);
  return { readings, events };
}
