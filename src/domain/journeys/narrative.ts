/**
 * The deterministic narrative header (spec §6.5). One honest sentence from real counts —
 * replaced by the `journey_narrative` task in Phase 10, never by invented accuracy.
 */
export interface NarrativeCounts {
  readings: number;
  events?: number;
  confirmedOutcomes: number;
  openLoops: number;
  deckSystems: number;
  /** ISO instant of the earliest object; null when there are none. */
  since: string | null;
  /** The viewer's "now" (tests pass a fixed instant). */
  now?: string;
}

function monthYear(iso: string, now: string): string {
  const d = new Date(iso);
  const n = new Date(now);
  const sameYear = d.getUTCFullYear() === n.getUTCFullYear();
  return d.toLocaleDateString('en', {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function narrativeHeader(c: NarrativeCounts): string {
  const now = c.now ?? new Date().toISOString();
  if (!c.since || c.readings + (c.events ?? 0) === 0)
    return 'Nothing here yet. As readings gather around this, they will show up below.';
  const parts: string[] = [count(c.readings, 'reading')];
  if (c.events) parts.push(count(c.events, 'life event'));
  parts.push(
    c.confirmedOutcomes > 0
      ? count(c.confirmedOutcomes, 'confirmed outcome')
      : 'no confirmed outcomes yet',
  );
  let s = `${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]} since ${monthYear(c.since, now)}`;
  if (c.deckSystems > 1) s += ', across both decks';
  s += '.';
  if (c.openLoops > 0)
    s += ` ${c.openLoops === 1 ? 'One reading is' : `${c.openLoops} readings are`} still open.`;
  return s;
}
