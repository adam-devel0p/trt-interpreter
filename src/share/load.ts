import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { UserClient } from '@/db/client';
import { getReading } from '@/db/queries/readings';
import { loadRetrospective } from '@/db/queries/retrospective';
import type { MonthForShare, ReadingForShare } from '@/domain/share/payload';
import { periodLabel, type Period } from '@/domain/summaries/periods';

/**
 * What a share card is built from, read as the user through RLS (so only the owner can
 * ever render their card). Everything here is stored data; nothing is generated.
 */

async function entityLabels(client: UserClient, readingIds: string[]): Promise<string[]> {
  if (readingIds.length === 0) return [];
  const { data } = await client
    .from('entity_mentions')
    .select('entities(canonical_label)')
    .eq('object_type', 'reading')
    .in('object_id', readingIds)
    .in('resolution', ['auto', 'user']);
  const labels = new Set<string>();
  for (const row of (data ?? []) as unknown as { entities: { canonical_label: string } | null }[])
    if (row.entities) labels.add(row.entities.canonical_label);
  return [...labels];
}

async function themeLabels(
  client: UserClient,
  readingIds: string[],
): Promise<{ label: string; weight: number }[]> {
  if (readingIds.length === 0) return [];
  const { data } = await client
    .from('object_themes')
    .select('weight, themes(label)')
    .eq('object_type', 'reading')
    .in('object_id', readingIds);
  const byLabel = new Map<string, number>();
  for (const row of (data ?? []) as unknown as {
    weight: string | number;
    themes: { label: string } | null;
  }[])
    if (row.themes)
      byLabel.set(row.themes.label, (byLabel.get(row.themes.label) ?? 0) + Number(row.weight));
  return [...byLabel]
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight);
}

const caption = (c: {
  numeral: string | null;
  rank_label: string | null;
  suit_label: string | null;
}) => [c.numeral ?? c.rank_label, c.suit_label].filter(Boolean).join(' · ') || null;

export async function loadReadingForShare(
  client: UserClient,
  readingId: string,
): Promise<ReadingForShare | null> {
  const reading = await getReading(client, readingId);
  if (!reading) return null;
  const [themes, entities] = await Promise.all([
    themeLabels(client, [reading.id]),
    entityLabels(client, [reading.id]),
  ]);
  return {
    occurredAt: reading.occurred_at,
    deck: { name: reading.deck.name, system: reading.deck.system },
    spread: { name: reading.spread.name },
    cards: reading.cards.map((c) => ({
      positionLabel: c.position?.name ?? c.position_key.replace(/_/g, ' '),
      name: c.card.name,
      reversed: c.orientation === 'reversed',
      artPath: c.card.art_asset_path,
      caption: caption(c.card),
    })),
    question: reading.is_open_reflection ? null : reading.question,
    notes: reading.user_notes,
    themes: themes.map((t) => t.label),
    entityLabels: entities,
  };
}

export async function loadMonthForShare(
  client: UserClient,
  period: Period,
): Promise<MonthForShare> {
  const data = await loadRetrospective(client, period);
  const readingIds = data.readings.map((r) => r.id);
  const counts = new Map<string, { name: string; count: number; deckSystem: 'rws' | 'thoth' }>();
  for (const r of data.readings)
    for (const c of r.cards) {
      const key = `${r.deck.system}:${c.card.name}`;
      const cur = counts.get(key) ?? { name: c.card.name, count: 0, deckSystem: r.deck.system };
      cur.count += 1;
      counts.set(key, cur);
    }
  const recurring = [...counts.values()]
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count);
  const themes = new Map<string, number>();
  for (const r of data.readings)
    for (const t of r.themes) themes.set(t.label, (themes.get(t.label) ?? 0) + t.weight);
  const journeyTitles = [...new Set(data.steps.map((s) => s.journey.title))];
  return {
    monthLabel: periodLabel(period),
    readings: data.readings.length,
    events: data.events.length,
    outcomes: data.outcomes.length,
    recurring,
    themes: [...themes].sort((a, b) => b[1] - a[1]).map(([label]) => label),
    journeyTitles,
    entityLabels: await entityLabels(client, readingIds),
  };
}

/** Bundled RWS art (WebP on disk) as PNG data URIs the image renderer can decode. */
export async function loadArt(paths: (string | null)[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(paths.filter((p): p is string => !!p))].map(async (p) => {
      try {
        const file = path.join(process.cwd(), 'public', `${p}-320.webp`);
        const png = await sharp(await readFile(file))
          .png()
          .toBuffer();
        out[p] = `data:image/png;base64,${png.toString('base64')}`;
      } catch {
        /* no art: the renderer falls back to the typographic face */
      }
    }),
  );
  return out;
}
