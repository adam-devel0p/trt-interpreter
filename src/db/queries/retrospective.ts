/**
 * The monthly (or weekly) retrospective's data (spec §15.2): everything the screen shows
 * comes from stored, user-confirmed rows — readings and their cards, logged events,
 * recorded outcomes, journey progression steps that fall in the period, open loops —
 * through the user client. The generated summary, if one exists, is read separately and
 * adds prose; the screen stands without it. Opening it makes no model call (§19).
 */
import type { UserClient } from '@/db/client';
import type { Period } from '@/domain/summaries/periods';
import { toItem, type JournalItem, type RawItem, ITEM_SELECT } from './journal';
import { listLinksForObjects, type OutcomeView } from './events';

export class RetrospectiveQueryError extends Error {
  override name = 'RetrospectiveQueryError';
}
const fail = (what: string, e: { message: string }): never => {
  throw new RetrospectiveQueryError(`${what}: ${e.message}`);
};

export interface RetroReading extends JournalItem {
  positions: { key: string; name: string }[];
  themes: { slug: string; label: string; weight: number }[];
  journeys: { id: string; title: string }[];
}

export interface RetroEvent {
  id: string;
  description: string;
  occurred_on: string;
  event_type: string | null;
}

export interface RetroOutcome extends OutcomeView {
  reading: { id: string; question: string | null; is_open_reflection: boolean } | null;
}

export interface RetroJourneyStep {
  journey: { id: string; title: string; status: string };
  label: string;
  slug: string;
  period_start: string;
  period_end: string;
  source_object_ids: string[];
}

export interface RetrospectiveData {
  readings: RetroReading[];
  events: RetroEvent[];
  outcomes: RetroOutcome[];
  steps: RetroJourneyStep[];
  /** Reading ↔ event pairs the user confirmed a connection for. */
  confirmedLinks: { readingId: string; eventId: string }[];
}

export async function loadRetrospective(
  client: UserClient,
  period: Pick<Period, 'start' | 'end'>,
): Promise<RetrospectiveData> {
  const from = `${period.start}T00:00:00.000Z`;
  const to = `${period.end}T23:59:59.999Z`;
  const [r, e, o, s] = await Promise.all([
    client
      .from('readings')
      .select(
        ITEM_SELECT.replace(
          'spreads(id, name, card_count)',
          'spreads(id, name, card_count, positions)',
        ),
      )
      .is('deleted_at', null)
      .gte('occurred_at', from)
      .lte('occurred_at', to)
      .order('occurred_at', { ascending: true }),
    client
      .from('life_events')
      .select('id, description, occurred_on, event_type')
      .is('deleted_at', null)
      .gte('occurred_on', period.start)
      .lte('occurred_on', period.end)
      .order('occurred_on', { ascending: true }),
    client
      .from('outcomes')
      .select(
        'id, reading_id, prediction_id, life_event_id, status, note, user_confirmed_at, created_at, ' +
          'life_events(id, description, occurred_on, deleted_at), readings(id, question, is_open_reflection, deleted_at)',
      )
      .gte('user_confirmed_at', from)
      .lte('user_confirmed_at', to)
      .order('user_confirmed_at', { ascending: true }),
    client
      .from('journey_theme_progression')
      .select(
        'period_start, period_end, source_object_ids, themes(slug, label), journeys(id, title, status, merged_into_id, dismissed_at)',
      )
      .lte('period_start', period.end)
      .gte('period_end', period.start),
  ]);
  if (r.error) fail('retrospective readings', r.error);
  if (e.error) fail('retrospective events', e.error);
  if (o.error) fail('retrospective outcomes', o.error);
  if (s.error) fail('retrospective progression', s.error);

  type RawReading = RawItem & {
    spreads: RawItem['spreads'] & { positions: { key: string; name: string }[] | null };
  };
  const rawReadings = (r.data ?? []) as unknown as RawReading[];
  const readingIds = rawReadings.map((x) => x.id);
  const [t, m, links] = await Promise.all([
    readingIds.length
      ? client
          .from('object_themes')
          .select('object_id, weight, themes(slug, label)')
          .eq('object_type', 'reading')
          .in('object_id', readingIds)
      : Promise.resolve({ data: [], error: null }),
    readingIds.length
      ? client
          .from('journey_members')
          .select('object_id, state, journeys(id, title, merged_into_id)')
          .eq('object_type', 'reading')
          .in('object_id', readingIds)
          .in('state', ['auto', 'confirmed'])
      : Promise.resolve({ data: [], error: null }),
    listLinksForObjects(client, {
      readings: readingIds,
      events: ((e.data ?? []) as RetroEvent[]).map((x) => x.id),
    }),
  ]);
  if (t.error) fail('retrospective themes', t.error);
  if (m.error) fail('retrospective memberships', m.error);

  const themesByReading = new Map<string, RetroReading['themes']>();
  for (const row of (t.data ?? []) as unknown as {
    object_id: string;
    weight: string | number;
    themes: { slug: string; label: string } | null;
  }[]) {
    if (!row.themes) continue;
    const list = themesByReading.get(row.object_id) ?? [];
    list.push({ slug: row.themes.slug, label: row.themes.label, weight: Number(row.weight) });
    themesByReading.set(row.object_id, list);
  }
  for (const list of themesByReading.values()) list.sort((a, b) => b.weight - a.weight);
  const journeysByReading = new Map<string, RetroReading['journeys']>();
  for (const row of (m.data ?? []) as unknown as {
    object_id: string;
    journeys: { id: string; title: string; merged_into_id: string | null } | null;
  }[]) {
    if (!row.journeys || row.journeys.merged_into_id) continue;
    const list = journeysByReading.get(row.object_id) ?? [];
    if (!list.some((j) => j.id === row.journeys!.id))
      list.push({ id: row.journeys.id, title: row.journeys.title });
    journeysByReading.set(row.object_id, list);
  }
  const readings: RetroReading[] = rawReadings.map((raw) => ({
    ...toItem(raw),
    positions: raw.spreads.positions ?? [],
    themes: themesByReading.get(raw.id) ?? [],
    journeys: journeysByReading.get(raw.id) ?? [],
  }));

  type RawOutcome = Omit<OutcomeView, 'event'> & {
    life_events: {
      id: string;
      description: string;
      occurred_on: string;
      deleted_at: string | null;
    } | null;
    readings: {
      id: string;
      question: string | null;
      is_open_reflection: boolean;
      deleted_at: string | null;
    } | null;
  };
  const outcomes: RetroOutcome[] = ((o.data ?? []) as unknown as RawOutcome[])
    .filter((x) => x.readings && !x.readings.deleted_at)
    .map(({ life_events, readings: rd, ...row }) => ({
      ...row,
      event:
        life_events && !life_events.deleted_at
          ? {
              id: life_events.id,
              description: life_events.description,
              occurred_on: life_events.occurred_on,
            }
          : null,
      reading: rd
        ? { id: rd.id, question: rd.question, is_open_reflection: rd.is_open_reflection }
        : null,
    }));

  type RawStep = {
    period_start: string;
    period_end: string;
    source_object_ids: string[];
    themes: { slug: string; label: string } | null;
    journeys: {
      id: string;
      title: string;
      status: string;
      merged_into_id: string | null;
      dismissed_at: string | null;
    } | null;
  };
  const steps: RetroJourneyStep[] = ((s.data ?? []) as unknown as RawStep[])
    .filter((x) => x.themes && x.journeys && !x.journeys.merged_into_id && !x.journeys.dismissed_at)
    .filter((x) => x.journeys!.status !== 'suggested')
    .map((x) => ({
      journey: { id: x.journeys!.id, title: x.journeys!.title, status: x.journeys!.status },
      label: x.themes!.label,
      slug: x.themes!.slug,
      period_start: x.period_start,
      period_end: x.period_end,
      source_object_ids: x.source_object_ids,
    }))
    .sort((a, b) => (a.period_start < b.period_start ? -1 : 1));

  return {
    readings,
    events: (e.data ?? []) as RetroEvent[],
    outcomes,
    steps,
    confirmedLinks: links
      .filter(
        (l) => l.state === 'confirmed' && l.from_type === 'reading' && l.to_type === 'life_event',
      )
      .map((l) => ({ readingId: l.from_id, eventId: l.to_id })),
  };
}

/** Months (and weeks) with any live reading or event: the retrospective index. */
export async function listActivePeriodStarts(
  client: UserClient,
): Promise<{ readings: string[]; events: string[] }> {
  const [r, e] = await Promise.all([
    client
      .from('readings')
      .select('occurred_at')
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .limit(2000),
    client
      .from('life_events')
      .select('occurred_on')
      .is('deleted_at', null)
      .order('occurred_on', { ascending: false })
      .limit(2000),
  ]);
  if (r.error) fail('active periods', r.error);
  if (e.error) fail('active periods', e.error);
  return {
    readings: ((r.data ?? []) as { occurred_at: string }[]).map((x) => x.occurred_at),
    events: ((e.data ?? []) as { occurred_on: string }[]).map((x) => x.occurred_on),
  };
}
