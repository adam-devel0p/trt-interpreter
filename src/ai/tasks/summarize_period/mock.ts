/**
 * Rule-based summariser for the mock provider: reasons over the package as structure, cites
 * only labels it was given, and labels each claim with an honest basis — so the whole
 * generation, verification and storage path runs without a model, and the eval's
 * mechanical checks have a baseline to compare the real model against.
 */
import type { FixtureRequest } from '../../providers/mock';
import type { MockEvidenceObject } from '../answer_from_evidence';
import type { PeriodSummary, SummaryClaim } from './schema';

const MONTH_DAY = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

function counted(map: Map<string, string[]>, min: number): [string, string[]][] {
  return [...map]
    .filter(([, labels]) => labels.length >= min)
    .sort((a, b) => b[1].length - a[1].length);
}

export function mockPeriodSummary(req: FixtureRequest): PeriodSummary {
  const objects = (req.mockInput?.objects as MockEvidenceObject[] | undefined) ?? [];
  const periodLabel = String(req.mockInput?.periodLabel ?? 'this period');
  const readings = objects.filter((o) => o.type === 'reading');
  const events = objects.filter((o) => o.type === 'life_event');

  // Recurred: cards and themes across distinct readings.
  const cards = new Map<string, string[]>();
  const themes = new Map<string, string[]>();
  for (const r of readings) {
    for (const c of new Set(r.cards)) cards.set(c, [...(cards.get(c) ?? []), r.label]);
    for (const t of new Set(r.themes)) themes.set(t, [...(themes.get(t) ?? []), r.label]);
  }
  const recurred: SummaryClaim[] = [];
  for (const [card, labels] of counted(cards, 2).slice(0, 2))
    recurred.push({
      text:
        labels.length >= 3
          ? `${card} came up in ${labels.length} readings — a pattern worth sitting with, one way to read it being that the same question kept returning.`
          : `${card} appeared twice — noted, not yet a pattern.`,
      basis: 'tarot_interpretation',
      citations: labels.slice(0, 8),
    });
  for (const [theme, labels] of counted(themes, 3).slice(0, 2))
    recurred.push({
      text: `The journal tagged ${theme.toLowerCase()} on ${labels.length} entries this period.`,
      basis: 'inferred',
      citations: labels.slice(0, 8),
    });

  // Shifted: the strongest theme of the first half vs the second half.
  const shifted: SummaryClaim[] = [];
  const dated = [...readings].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const top = (rs: MockEvidenceObject[]) => {
      const m = new Map<string, number>();
      for (const r of rs) for (const t of r.themes.slice(0, 2)) m.set(t, (m.get(t) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const early = top(dated.slice(0, half));
    const late = top(dated.slice(half));
    if (early && late && early !== late)
      shifted.push({
        text: `Earlier entries leaned toward ${early.toLowerCase()}; later ones toward ${late.toLowerCase()} — which may point to the question moving on.`,
        basis: 'inferred',
        citations: [
          ...dated
            .slice(0, half)
            .map((r) => r.label)
            .slice(0, 3),
          ...dated
            .slice(half)
            .map((r) => r.label)
            .slice(0, 3),
        ],
      });
  }

  // Open: unresolved readings, in the user's words.
  const open: SummaryClaim[] = readings
    .filter((r) => r.followUp === 'unresolved' || r.followUp === 'partly_resolved')
    .slice(0, 3)
    .map((r) => ({
      text: r.title
        ? `Still open: “${r.title}” from ${MONTH_DAY(r.date)}.`
        : `The open reflection from ${MONTH_DAY(r.date)} has no answer yet.`,
      basis: 'user_reflection',
      citations: [r.label],
    }));

  // Confirmed: outcomes, logged events, confirmed connections.
  const confirmed: SummaryClaim[] = [];
  for (const r of readings)
    for (const o of r.outcomes.slice(0, 1))
      confirmed.push({
        text: `You recorded that ${MONTH_DAY(r.date)}'s “${r.title ?? 'open reflection'}” ${o.status.replace(/_/g, ' ')}${o.note ? ` — “${o.note}”` : ''}.`,
        basis: 'confirmed_fact',
        citations: [r.label],
      });
  for (const e of events.slice(0, 3))
    confirmed.push({
      text: `On ${MONTH_DAY(e.date)} you logged “${e.title ?? 'a life event'}”${
        e.links.some((l) => l.state === 'confirmed')
          ? ', and confirmed its connection to an earlier reading'
          : ''
      }.`,
      basis: 'confirmed_fact',
      citations: [e.label],
    });

  const topTheme = counted(themes, 1)[0]?.[0];
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const headline =
    readings.length + events.length === 0
      ? `Nothing was recorded in ${periodLabel}.`
      : `${cap(periodLabel)}: ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'} and ${events.length} ${events.length === 1 ? 'life event' : 'life events'}${topTheme ? `, mostly circling ${topTheme.toLowerCase()}` : ''}${confirmed.length ? `, with ${confirmed.length} ${confirmed.length === 1 ? 'thing' : 'things'} you confirmed happened` : ''}.`;

  return {
    headline,
    recurred: recurred.slice(0, 4),
    shifted: shifted.slice(0, 4),
    open: open.slice(0, 4),
    confirmed: confirmed.slice(0, 4),
  };
}
