import { eq, inArray } from 'drizzle-orm';
import { platformDb } from '../src/db/admin';
import { cards, decks, readingCards, readings, spreads } from '../src/db/schema';
import { drawCards } from '../src/domain/readings/draw';
import { seededRng, type Rng } from '../src/domain/readings/prng';
import type { FollowUpStatus, LifeAreaKey } from '../src/domain/readings/types';
import type { SeedContext } from './seed-demo';

/**
 * Phase 03 — a coherent, fictional six-month reading history for each demo user: both decks,
 * both sources, every built-in spread, some notes in the user's voice, some revisit dates,
 * some resolved. Deterministic from `ctx.seed`; regenerated on every run (the demo journal
 * is disposable by design — later phases derive from it, so a re-run resets those too).
 */

interface Story {
  daysAgo: number;
  question: string | null;
  lifeArea: LifeAreaKey | null;
  spread: string;
  deck: 'rws-classic' | 'thoth';
  source: 'digital' | 'physical';
  notes: string | null;
  followUp: FollowUpStatus;
  revisitInDays: number | null;
  /** Phase 05: soft-deleted rows exercise the purge job and must never appear in any view. */
  deleted?: boolean;
  /** Phase 05: kept whatever `--months` says (a back-dated physical reading from years ago). */
  backdated?: boolean;
}

/** A long, searchable note in the user's voice (Phase 05: FTS + trigram over notes). */
const LONG_NOTE =
  'I keep coming back to this one. The Eight of Cups in the outcome position is the card I ' +
  'drew the week before I left the agency, and here it is again with the Hermit next to it. ' +
  'Two readings of the same walking-away. What I notice this time: I am not sad about it. ' +
  'The Star underneath is the part I did not have last year. If the flat in Leeds falls ' +
  'through I will still have moved something. Sam said the same thing on the phone, in his ' +
  'own words — that I already decided and the cards are just the paperwork. Revisit in a ' +
  'month and see whether the paperwork held.';

/** Ana: digital, RWS by default, a job change and a move over the summer. */
const ANA: Story[] = [
  {
    daysAgo: 178,
    question: 'What do I need to know about the year ahead?',
    lifeArea: null,
    spread: 'celtic-cross-lite',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'A lot of pentacles. Money and ground, again.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 170,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'not_relevant',
    revisitInDays: null,
  },
  {
    daysAgo: 162,
    question: 'Should I apply for the design lead role?',
    lifeArea: 'work',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'The advice card felt like: stop waiting to be asked.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 155,
    question: 'How is it going with M.?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'digital',
    notes:
      'Three of Cups in the present. We are fine, I think — my girlfriend says I go quiet when it matters.',
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 141,
    question: 'Take the offer or stay?',
    lifeArea: 'work',
    spread: 'decision',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'Path B asks for a lot but opens more. I keep circling the Eight of Cups.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 133,
    question: null,
    lifeArea: 'self',
    spread: 'one-card',
    deck: 'thoth',
    source: 'digital',
    notes: 'Trying the Thoth deck. Adjustment — the balance I keep asking about.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 120,
    question: 'What is the move to Leeds asking of me?',
    lifeArea: 'home',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'digital',
    notes:
      'Maya, my girlfriend, thinks Leeds is too far from everyone. The Eight of Wands says go anyway.',
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 108,
    question: 'Will the flat viewing on Friday go well?',
    lifeArea: 'home',
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 96,
    question: 'What am I not seeing about the new team?',
    lifeArea: 'work',
    spread: 'celtic-cross-lite',
    deck: 'thoth',
    source: 'digital',
    notes: 'The crossing card is the Prince of Swords. Someone is faster than they are careful.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 84,
    question: 'How do I keep the friendship with J. alive from a distance?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 70,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'physical',
    notes: 'Drew this with the old deck at my mum’s. The Star.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 58,
    question: 'Is the side project worth the evenings?',
    lifeArea: 'creativity',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 45,
    question: 'What does the autumn hold for my health?',
    lifeArea: 'health',
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'Temperance in the future spot. Slow down.',
    followUp: 'unresolved',
    revisitInDays: 30,
  },
  {
    daysAgo: 31,
    question: 'Should I say yes to the conference talk?',
    lifeArea: 'work',
    spread: 'decision',
    deck: 'thoth',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 20,
  },
  {
    daysAgo: 20,
    question: 'How are things really with M.?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'digital',
    notes:
      'Same present card as in March. Noted. Maya and I are not together any more — my ex now, I suppose. Sam says give it a month.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 12,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 6,
    question: 'What should I focus on before the review?',
    lifeArea: 'work',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 14,
  },
  {
    daysAgo: 3,
    question: 'Will the new routine stick?',
    lifeArea: 'health',
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'Nine of Pentacles. Quiet confidence.',
    followUp: 'unresolved',
    revisitInDays: 30,
  },
  {
    daysAgo: 1,
    question: null,
    lifeArea: 'self',
    spread: 'one-card',
    deck: 'thoth',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 0,
    question: 'What do I carry into this week?',
    lifeArea: null,
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 7,
  },
  {
    daysAgo: 33,
    question: 'Is leaving the agency the same story as leaving the flat?',
    lifeArea: 'self',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'physical',
    notes: LONG_NOTE,
    followUp: 'partly_resolved',
    revisitInDays: 30,
  },
  {
    daysAgo: 1040,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'physical',
    notes: 'Found this in an old notebook. Back-dated from the page.',
    followUp: 'not_relevant',
    revisitInDays: null,
    backdated: true,
  },
  {
    daysAgo: 12,
    question: 'Deleted by accident, then deleted on purpose',
    lifeArea: null,
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'digital',
    notes: 'This one should never show anywhere.',
    followUp: 'unresolved',
    revisitInDays: null,
    deleted: true,
  },
  {
    daysAgo: 4,
    question: null,
    lifeArea: null,
    spread: 'three-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
    deleted: true,
  },
];

/** Ben: physical decks, Thoth by preference, a long relationship question and a house sale. */
const BEN: Story[] = [
  {
    daysAgo: 181,
    question: 'What is the shape of this year?',
    lifeArea: null,
    spread: 'celtic-cross-lite',
    deck: 'thoth',
    source: 'physical',
    notes: 'The Universe in the outcome position. A cycle closing.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 174,
    question: 'Should we list the house in spring?',
    lifeArea: 'home',
    spread: 'decision',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 166,
    question: 'How do I approach the conversation with my brother?',
    lifeArea: 'family',
    spread: 'situation-advice-outcome',
    deck: 'thoth',
    source: 'physical',
    notes: 'Advice: Peace. Say less.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 158,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'not_relevant',
    revisitInDays: null,
  },
  {
    daysAgo: 149,
    question: 'What is unresolved between R. and me?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'thoth',
    source: 'physical',
    notes: 'Past: Ruin. I did not expect that to be the past card.',
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 137,
    question: 'Is the offer on the house fair?',
    lifeArea: 'money',
    spread: 'one-card',
    deck: 'rws-classic',
    source: 'physical',
    notes: 'Used the Waite deck for a change. Justice, reversed.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 126,
    question: 'What do the next three months need from me?',
    lifeArea: null,
    spread: 'three-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 114,
    question: 'How do I support Dad without taking over?',
    lifeArea: 'family',
    spread: 'situation-advice-outcome',
    deck: 'thoth',
    source: 'physical',
    notes: 'Advice card: the Princess of Cups. Softer than I am being.',
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 101,
    question: null,
    lifeArea: 'self',
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 89,
    question: 'Where is the money going, honestly?',
    lifeArea: 'money',
    spread: 'celtic-cross-lite',
    deck: 'thoth',
    source: 'physical',
    notes: 'Beneath: Works. Above: Wealth. Between them, a lot of small spending.',
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 77,
    question: 'What would help R. and me talk again?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'rws-classic',
    source: 'physical',
    notes: null,
    followUp: 'partly_resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 64,
    question: 'Is the workshop idea alive?',
    lifeArea: 'creativity',
    spread: 'situation-advice-outcome',
    deck: 'thoth',
    source: 'digital',
    notes: 'First digital draw. Strange without the cards in hand.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 52,
    question: 'How will the move-out weekend go?',
    lifeArea: 'home',
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'resolved',
    revisitInDays: null,
  },
  {
    daysAgo: 40,
    question: 'What is my part in the tension at the club?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'thoth',
    source: 'physical',
    notes: 'Present: Strife. Yes.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 28,
    question: 'Should I take the part-time contract?',
    lifeArea: 'work',
    spread: 'decision',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 30,
  },
  {
    daysAgo: 17,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: 'The Aeon. Something judged and finished.',
    followUp: 'unresolved',
    revisitInDays: null,
  },
  {
    daysAgo: 10,
    question: 'How do I mark the anniversary this year?',
    lifeArea: 'family',
    spread: 'situation-advice-outcome',
    deck: 'rws-classic',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 21,
  },
  {
    daysAgo: 5,
    question: 'What am I avoiding about the tax letter?',
    lifeArea: 'money',
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 7,
  },
  {
    daysAgo: 2,
    question: 'Will R. come to the dinner?',
    lifeArea: 'relationships',
    spread: 'three-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: 10,
  },
  {
    daysAgo: 0,
    question: null,
    lifeArea: null,
    spread: 'one-card',
    deck: 'thoth',
    source: 'physical',
    notes: null,
    followUp: 'unresolved',
    revisitInDays: null,
  },
];

const STORIES: Record<string, Story[]> = {
  'demo-ana@tarot.local': ANA,
  'demo-ben@tarot.local': BEN,
};

function hex(rng: Rng): string {
  return Array.from({ length: 4 }, () => rng.int(0x1_0000_0000).toString(16).padStart(8, '0')).join(
    '',
  );
}

export async function seedReadings(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedReadings needs the users seeder first');
  const rng = seededRng(ctx.seed.toString(16).padStart(32, '0'));

  const deckRows = await db.select().from(decks);
  const spreadRows = await db.select().from(spreads).where(eq(spreads.isBuiltin, true));
  const cardRows = await db
    .select({ id: cards.id, deckId: cards.deckId, sortOrder: cards.sortOrder })
    .from(cards);
  if (deckRows.length < 2 || spreadRows.length < 5) {
    throw new Error('reference data missing — run `pnpm db:seed` first');
  }
  const deckBySlug = new Map(deckRows.map((d) => [d.slug, d]));
  const spreadBySlug = new Map(spreadRows.map((s) => [s.slug, s]));
  const cardIdsByDeck = new Map(
    deckRows.map((d) => [
      d.id,
      cardRows
        .filter((c) => c.deckId === d.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => c.id),
    ]),
  );

  // Regenerate: the demo journal is disposable.
  await db.delete(readings).where(inArray(readings.userId, userIds));

  const { DEMO_USERS } = await import('./seed-demo');
  let total = 0;
  ctx.ids.readings = [];
  for (const [i, userId] of userIds.entries()) {
    const email = DEMO_USERS[i]?.email;
    const stories = (email && STORIES[email]) ?? [];
    for (const story of stories) {
      if (story.daysAgo > ctx.months * 31 && !story.deleted && !story.backdated) continue;
      const deck = deckBySlug.get(story.deck)!;
      const spread = spreadBySlug.get(story.spread)!;
      const positions = spread.positions as { key: string }[];
      const usesReversals = deck.supportsReversals && story.deck === 'rws-classic';
      const occurredAt = new Date();
      occurredAt.setUTCDate(occurredAt.getUTCDate() - story.daysAgo);
      occurredAt.setUTCHours(8 + rng.int(13), rng.int(60), 0, 0);
      const draw = drawCards({
        cardIds: cardIdsByDeck.get(deck.id)!,
        deckId: deck.id,
        count: positions.length,
        usesReversals,
        seed: hex(rng),
        now: occurredAt,
      });
      const revisitAt =
        story.revisitInDays === null
          ? null
          : new Date(occurredAt.getTime() + story.revisitInDays * 86_400_000);

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(readings)
          .values({
            userId,
            createdAt: occurredAt,
            occurredAt,
            question: story.question,
            isOpenReflection: story.question === null,
            lifeArea: story.lifeArea,
            spreadId: spread.id,
            deckId: deck.id,
            source: story.source,
            usesReversals,
            userNotes: story.notes,
            followUpStatus: story.followUp,
            revisitAt,
            rng: story.source === 'digital' ? draw.rng : null,
            deletedAt: story.deleted ? new Date(occurredAt.getTime() + 3_600_000) : null,
          })
          .returning({ id: readings.id });
        await tx.insert(readingCards).values(
          draw.cards.map((c) => ({
            readingId: row!.id,
            userId,
            positionIndex: c.position_index,
            positionKey: positions[c.position_index]?.key ?? `position_${c.position_index + 1}`,
            cardId: c.card_id,
            orientation: c.orientation,
            sortOrder: c.position_index,
            createdAt: occurredAt,
          })),
        );
        ctx.ids.readings!.push(row!.id);
      });
      total++;
    }
  }
  console.log(`  ${total} readings across ${userIds.length} users (${ctx.months} months)`);
}

/**
 * Phase 05 — a generated journal of `count` readings for one user, spread over ~3 years, both
 * decks, every built-in spread, notes on a third of them. Deterministic from `seed`. Used by
 * `pnpm demo:seed --bulk N` (demo-cleo) and by the journal performance and scroll tests.
 */
export async function seedBulkReadings(
  userId: string,
  count: number,
  seed: number,
): Promise<string[]> {
  const db = platformDb();
  const rng = seededRng((seed + 7).toString(16).padStart(32, '0'));
  const deckRows = await db.select().from(decks);
  const spreadRows = await db.select().from(spreads).where(eq(spreads.isBuiltin, true));
  const cardRows = await db
    .select({ id: cards.id, deckId: cards.deckId, sortOrder: cards.sortOrder })
    .from(cards);
  const cardIdsByDeck = new Map(
    deckRows.map((d) => [
      d.id,
      cardRows
        .filter((c) => c.deckId === d.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => c.id),
    ]),
  );
  const QUESTIONS = [
    'What should I know about the week ahead?',
    'How do I handle the conversation with my manager?',
    'What is the move asking of me?',
    'Where is the money going?',
    'What does this friendship need?',
    'What am I avoiding at home?',
    'Is the course worth finishing?',
    'What would help me sleep?',
  ];
  const NOTES = [
    'Swords again. I notice I ask this when I am tired.',
    'The Tower reversed feels gentler than I expected.',
    'Three cups in a row. Something social is coming, or I want it to.',
    'Nothing landed. Keeping it anyway.',
    LONG_NOTE,
  ];
  const AREAS = ['work', 'money', 'relationships', 'home', 'self', 'health', null] as const;
  const FOLLOW: FollowUpStatus[] = ['unresolved', 'resolved', 'partly_resolved', 'not_relevant'];

  await db.delete(readings).where(eq(readings.userId, userId));
  const ids: string[] = [];
  const BATCH = 100;
  for (let start = 0; start < count; start += BATCH) {
    const readingValues: (typeof readings.$inferInsert)[] = [];
    const cardValues: (typeof readingCards.$inferInsert)[][] = [];
    for (let i = start; i < Math.min(start + BATCH, count); i++) {
      const deck = deckRows[rng.int(deckRows.length)]!;
      const spread = spreadRows[rng.int(spreadRows.length)]!;
      const positions = spread.positions as { key: string }[];
      const usesReversals = deck.supportsReversals && rng.int(2) === 0;
      const occurredAt = new Date(Date.now() - (i * 1.1 + rng.int(12)) * 86_400_000);
      const draw = drawCards({
        cardIds: cardIdsByDeck.get(deck.id)!,
        deckId: deck.id,
        count: positions.length,
        usesReversals,
        seed: hex(rng),
        now: occurredAt,
      });
      const isOpen = rng.int(5) === 0;
      const source = rng.int(3) === 0 ? 'physical' : 'digital';
      readingValues.push({
        userId,
        createdAt: occurredAt,
        occurredAt,
        question: isOpen ? null : QUESTIONS[rng.int(QUESTIONS.length)]!,
        isOpenReflection: isOpen,
        lifeArea: AREAS[rng.int(AREAS.length)] ?? null,
        spreadId: spread.id,
        deckId: deck.id,
        source,
        usesReversals,
        userNotes: rng.int(3) === 0 ? NOTES[rng.int(NOTES.length)]! : null,
        followUpStatus: FOLLOW[rng.int(FOLLOW.length)]!,
        revisitAt: rng.int(6) === 0 ? new Date(occurredAt.getTime() + 30 * 86_400_000) : null,
        rng: source === 'digital' ? draw.rng : null,
      });
      cardValues.push(
        draw.cards.map((c) => ({
          readingId: '',
          userId,
          positionIndex: c.position_index,
          positionKey: positions[c.position_index]?.key ?? `position_${c.position_index + 1}`,
          cardId: c.card_id,
          orientation: c.orientation,
          sortOrder: c.position_index,
          createdAt: occurredAt,
        })),
      );
    }
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(readings)
        .values(readingValues)
        .returning({ id: readings.id });
      const allCards = inserted.flatMap((row, k) =>
        cardValues[k]!.map((c) => ({ ...c, readingId: row.id })),
      );
      await tx.insert(readingCards).values(allCards);
      ids.push(...inserted.map((r) => r.id));
    });
  }
  return ids;
}
