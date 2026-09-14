import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import { lifeEvents, links, outcomes, profiles, readings } from '../src/db/schema';
import { runExplainCorrelation } from '../src/correlation/explain';
import { correlateObject } from '../src/correlation/run';
import {
  actOnLink,
  createEvent,
  listLinksForObject,
  recordOutcome,
} from '../src/db/queries/events';
import { createTokenUserClient } from '../src/db/client';
import { runEventExtraction } from '../src/events/extract';
import { refreshJourneys, journeysOfObjects } from '../src/journeys/refresh';
import type { SeedContext } from './seed-demo';
import { DEMO_PASSWORD, DEMO_USERS } from './seed-demo';

/**
 * Phase 08 — life events, outcomes and connections for the demo journal, produced by the real
 * pipeline: each event is saved as the user, extracted (mock provider), filed into journeys
 * by assignment, scored against the readings around it by the correlation engine, and the
 * offered links explained. Then the things a person would have done over six months: confirm
 * a few connections, reject one (so the §19 memory is visible), leave one as a maybe, record
 * outcomes of every status — some pointing at the event that *was* the outcome — and leave
 * two revisit dates overdue for Home. Ben (no AI) logs three events that connect to nothing.
 * Wipes and rebuilds, like the seeders before it.
 */
interface EventStory {
  daysAgo: number;
  description: string;
  note?: string;
  /** Substring of the reading's question this event was logged *about* (a user link). */
  about?: string;
}

const ANA: EventStory[] = [
  { daysAgo: 160, description: 'Applied for the design lead role at the agency.' },
  { daysAgo: 150, description: 'Maya and I had the conversation about the distance.' },
  {
    daysAgo: 138,
    description: 'I accepted the offer from the agency today.',
    note: 'Start on the first Monday of next month. Told Sam over dinner.',
    about: 'Take the offer or stay',
  },
  { daysAgo: 118, description: 'Viewed a flat in Leeds with Maya.' },
  { daysAgo: 106, description: 'The flat viewing in Leeds went well; we put in an offer.' },
  { daysAgo: 95, description: 'First week on the new team at the agency.' },
  { daysAgo: 80, description: 'Long phone call with J. about the distance.' },
  { daysAgo: 55, description: 'Spent the evenings on the side project instead of sleeping.' },
  { daysAgo: 40, description: 'Saw the doctor about the sleep problems.' },
  { daysAgo: 28, description: 'Said yes to the conference talk the agency offered.' },
  { daysAgo: 18, description: 'Maya and I decided to take a break.' },
  { daysAgo: 10, description: 'Went for a long walk to clear my head.' },
  { daysAgo: 5, description: 'Started the new routine: bed by eleven, run at seven.' },
  { daysAgo: 2, description: 'The review at the agency went better than I feared.' },
  { daysAgo: 1, description: 'Dinner with Sam.' },
];

const BEN: EventStory[] = [
  { daysAgo: 130, description: 'Accepted the offer on the house.' },
  { daysAgo: 60, description: 'Dad moved into the flat downstairs.' },
  { daysAgo: 9, description: 'First workshop session, six people came.' },
];

const DAY = 86_400_000;
const dateOf = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

/** A session for the demo user: the seeder acts *as* them, through RLS, like the UI. */
async function userClient(email: string) {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const signIn = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await signIn.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  const token = session.data.session?.access_token;
  if (!token) throw new Error(`demo sign-in failed for ${email}: ${session.error?.message}`);
  return createTokenUserClient(token);
}

export async function seedEvents(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedEvents needs the users seeder first');
  await db.delete(lifeEvents).where(inArray(lifeEvents.userId, userIds));
  await db.delete(links).where(inArray(links.userId, userIds));
  await db.delete(outcomes).where(inArray(outcomes.userId, userIds));

  let created = 0;
  let offered = 0;
  let explained = 0;
  for (const [i, u] of DEMO_USERS.entries()) {
    const userId = userIds[i]!;
    const stories = i === 0 ? ANA : i === 1 ? BEN : [];
    if (stories.length === 0) continue;
    const [profile] = await db
      .select({ consent: profiles.aiConsentAt })
      .from(profiles)
      .where(eq(profiles.id, userId));
    if (profile?.consent) {
      await platformSql()`
        insert into public.user_flags (user_id, flag, enabled, set_by)
        values (${userId}, 'correlation_suggestions', true, 'rollout')
        on conflict (user_id, flag) do update set enabled = true`;
    }
    const client = await userClient(u.email);
    const readingByQuestion = async (fragment: string) => {
      const [r] = await db
        .select({ id: readings.id })
        .from(readings)
        .where(
          and(
            eq(readings.userId, userId),
            isNull(readings.deletedAt),
            like(readings.question, `%${fragment}%`),
          ),
        )
        .limit(1);
      return r?.id ?? null;
    };

    const eventIds: string[] = [];
    for (const s of stories) {
      const id = await createEvent(client, userId, {
        description: s.description,
        occurred_on: dateOf(s.daysAgo),
        note: s.note ?? null,
        reading_id: s.about ? await readingByQuestion(s.about) : null,
      });
      eventIds.push(id);
      created += 1;
      await runEventExtraction(id); // skipped without consent — the event is complete regardless
      const out = await correlateObject('life_event', id);
      offered += out.offered;
      for (const l of await listLinksForObject(client, { type: 'life_event', id })) {
        if (l.state !== 'pending') continue;
        const ex = await runExplainCorrelation(l.id);
        if (ex.status === 'explained') explained += 1;
      }
    }
    await refreshJourneys(await journeysOfObjects('life_event', eventIds));

    if (i === 0) await anaActions(client, userId, eventIds, readingByQuestion);
  }
  console.log(
    `  ${created} life events logged, ${offered} connections offered, ${explained} explained`,
  );
}

/** What Ana did: decide on the suggestions, say what happened. */
async function anaActions(
  client: Awaited<ReturnType<typeof userClient>>,
  userId: string,
  eventIds: string[],
  readingByQuestion: (fragment: string) => Promise<string | null>,
): Promise<void> {
  const byIndex = (n: number) => eventIds[n]!;
  const pendingOf = async (eventId: string) =>
    (await listLinksForObject(client, { type: 'life_event', id: eventId })).filter(
      (l) => l.state === 'pending',
    );

  // Confirm the strongest suggestion on the events that clearly answer a reading.
  let confirmed = 0;
  for (const n of [0, 4, 9, 13]) {
    const [top] = await pendingOf(byIndex(n));
    if (top) {
      await actOnLink(client, top.id, 'confirmed');
      confirmed += 1;
    }
  }
  // "Dinner with Sam" is not about the agency: rejected — and never re-suggested (§19).
  let rejected = 0;
  const [samLink] = await pendingOf(byIndex(14));
  if (samLink) {
    await actOnLink(client, samLink.id, 'rejected');
    rejected += 1;
  }
  // The doctor's visit might relate to the health reading: left as a maybe.
  let maybes = 0;
  const [doctorLink] = await pendingOf(byIndex(8));
  if (doctorLink) {
    await actOnLink(client, doctorLink.id, 'maybe');
    maybes += 1;
  }

  // Outcomes of every status; some point at the event that was the outcome. The two
  // overdue revisits (health, leaving the agency) are left open for Home.
  const record = async (
    fragment: string,
    status: Parameters<typeof recordOutcome>[2]['status'],
    note: string | null,
    eventIndex: number | null,
  ) => {
    const readingId = await readingByQuestion(fragment);
    if (!readingId) return;
    await recordOutcome(client, userId, {
      readingId,
      predictionId: null,
      lifeEventId: eventIndex === null ? null : byIndex(eventIndex),
      status,
      note,
    });
  };
  await record('Take the offer or stay', 'happened', 'Took it. The paperwork held.', 2);
  await record('flat viewing on Friday', 'happened', null, 4);
  await record('conference talk', 'happened', 'Said yes before I could talk myself out of it.', 9);
  await record('How is it going with M.', 'partly', 'We talked. It helped for a while.', 1);
  await record('friendship with J.', 'did_not_happen', 'We never did find the rhythm.', null);
  await record(
    'side project worth',
    'irrelevant',
    'Shelved it; the new role took the evenings anyway.',
    null,
  );
  await record('What does Maya need', 'unresolved', null, null);
  await refreshJourneys(await journeysOfObjects('life_event', eventIds));
  console.log(
    `  Ana decided: ${confirmed} confirmed, ${rejected} rejected, ${maybes} maybe; 7 outcomes recorded across the five statuses`,
  );
}
