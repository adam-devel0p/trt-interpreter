/**
 * Rule-based answerer for the mock provider: reasons over the evidence package as structure
 * (labels, dates, titles, cards, themes, entities, outcomes, links) and composes a hedged,
 * cited answer per intent — or an honest "not enough evidence" when fewer than two entries
 * are relevant. It can only cite labels it was given, which is what the real prompt is told
 * to do; the verifier still checks it. Not the product's answerer; the model is.
 */
import type { HistoryAnswer } from '@/domain/retrieval/answer';
import type { HistoryQuery } from '@/domain/retrieval/query';
import type { FixtureRequest } from '../../providers/mock';
import type { MockEvidenceObject } from './index';

const MIN_RELEVANT = 2;

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase();
}

function mentions(o: MockEvidenceObject, term: string): boolean {
  const t = term.toLowerCase().replace(/^(the|my|our)\s+/, '');
  if (!t) return false;
  const hay = [o.title, o.noteExcerpt, ...o.entities, ...o.journeys, ...o.themes, o.lifeArea]
    .map(norm)
    .join(' | ');
  return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay);
}

function stem(w: string): string {
  return w.toLowerCase().replace(/(ings?|ed|es|s)$/, '');
}

/**
 * Strong evidence of relevance is a named thing (entity, comparison axis, card) or a topic
 * word in the entry's own words or tags; a matching life area or journey is weak. When any
 * entry matches strongly only those count; otherwise the weak matches; with no hints at all
 * the package order (retrieval's ranking) stands.
 */
function relevance(o: MockEvidenceObject, q: HistoryQuery): { strong: number; weak: number } {
  let strong = 0;
  let weak = 0;
  if (!q.object_types.includes(o.type)) return { strong: 0, weak: 0 };
  for (const e of q.entity_hints) if (mentions(o, e)) strong += 2;
  for (const a of q.comparison_axes) if (mentions(o, a)) strong += 2;
  for (const c of q.card_hints) if (o.cards.some((x) => norm(x) === norm(c))) strong += 2;
  for (const k of q.keywords) {
    const st = stem(k);
    if (st.length < 3) continue;
    const own = [o.title, ...o.themes].map(norm).join(' ');
    const rest = [o.noteExcerpt, ...o.journeys, o.lifeArea].map(norm).join(' ');
    if (own.includes(st)) strong += 1;
    else if (rest.includes(st)) weak += 1;
  }
  if (q.life_area && norm(o.lifeArea) === q.life_area) weak += 1;
  for (const j of q.journey_hints)
    if (o.journeys.some((t) => norm(t).includes(stem(j.split(' ').pop()!)))) weak += 1;
  return { strong, weak };
}

function selectRelevant(all: MockEvidenceObject[], q: HistoryQuery): MockEvidenceObject[] {
  const scored = all.map((o) => ({ o, ...relevance(o, q) }));
  const byDate = (a: { o: MockEvidenceObject }, b: { o: MockEvidenceObject }) =>
    a.o.date.localeCompare(b.o.date);
  const strong = scored
    .filter((x) => x.strong > 0)
    .sort((a, b) => b.strong - a.strong || byDate(a, b));
  const hasStrongHints = q.entity_hints.length + q.comparison_axes.length + q.card_hints.length > 0;
  if (hasStrongHints || strong.length >= MIN_RELEVANT) return strong.map((x) => x.o);
  // A topic word that hit only one entry is not enough on its own; widen to the weak matches.
  const weak = scored
    .filter((x) => x.weak > 0 && x.strong === 0)
    .sort((a, b) => b.weak - a.weak || byDate(a, b));
  if (strong.length + weak.length) return [...strong, ...weak].map((x) => x.o);
  const hintless = q.keywords.length === 0 && !q.life_area && q.journey_hints.length === 0;
  return hintless || q.intent === 'unresolved'
    ? all.filter((o) => q.object_types.includes(o.type))
    : [];
}

const when = (o: MockEvidenceObject) => o.date;
const said = (o: MockEvidenceObject) =>
  o.type === 'reading' ? (o.title ? `“${o.title}”` : 'an open reflection') : `“${o.title ?? ''}”`;
const cite = (list: MockEvidenceObject[]) => list.map((o) => o.label);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const listOf = (xs: string[], max = 4) =>
  xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;

function themeCounts(list: MockEvidenceObject[]): [string, number][] {
  const m = new Map<string, number>();
  for (const o of list) for (const t of o.themes) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function insufficient(
  all: MockEvidenceObject[],
  relevant: MockEvidenceObject[],
  q: HistoryQuery,
): HistoryAnswer {
  const topic = [...q.entity_hints, ...q.comparison_axes, ...q.keywords.slice(0, 2)].join(', ');
  const found =
    relevant.length > 0
      ? `Found ${relevant.length} ${relevant.length === 1 ? 'entry' : 'entries'} that ${relevant.length === 1 ? 'mentions' : 'mention'} ${topic || 'this'}: ${listOf(
          relevant.map((o) => `${when(o)} ${said(o)}`),
          3,
        )}.`
      : all.length > 0
        ? `Found ${all.length} ${all.length === 1 ? 'entry' : 'entries'} in this scope, but none ${topic ? `mention ${topic}` : 'fit the question'}.`
        : 'Nothing in your history matched this scope.';
  const narrower =
    relevant.length === 1
      ? `What did the ${when(relevant[0]!)} entry ${said(relevant[0]!)} say?`
      : q.time_range
        ? 'What did I ask about most this year?'
        : 'What have I asked about most often?';
  return {
    evidence_sufficient: false,
    conclusion: `There is not enough in your history to answer this${topic ? ` about ${topic}` : ''} with any confidence.`,
    claims: [],
    found,
    narrower_question: narrower,
  };
}

export function mockHistoryAnswer(req: FixtureRequest): HistoryAnswer {
  const q = req.mockInput?.query as HistoryQuery;
  const all = ((req.mockInput?.objects as MockEvidenceObject[] | undefined) ?? []).slice();
  const relevant = selectRelevant(all, q);
  if (relevant.length < MIN_RELEVANT) return insufficient(all, relevant, q);
  const byDate = relevant.slice().sort((a, b) => a.date.localeCompare(b.date));
  const claims: HistoryAnswer['claims'] = [];

  switch (q.intent) {
    case 'compare': {
      const axes = q.comparison_axes.length ? q.comparison_axes : q.entity_hints.slice(0, 2);
      const groups = axes.map((a) => ({ axis: a, list: byDate.filter((o) => mentions(o, a)) }));
      const empty = groups.filter((g) => g.list.length === 0);
      if (axes.length < 2 || empty.length)
        return {
          ...insufficient(all, relevant, q),
          found: `Found entries about ${
            groups
              .filter((g) => g.list.length)
              .map((g) => g.axis)
              .join(' and ') || 'neither'
          }, but none about ${empty.map((g) => g.axis).join(' or ') || 'the other side'}.`,
        };
      for (const g of groups) {
        const th = themeCounts(g.list)
          .slice(0, 3)
          .map(([t]) => t);
        const cards = uniq(g.list.flatMap((o) => o.cards)).slice(0, 4);
        claims.push({
          text: `About ${g.axis}: ${g.list.length} ${g.list.length === 1 ? 'entry' : 'entries'} (${listOf(g.list.map(when), 3)})${th.length ? `, tagged ${listOf(th)}` : ''}${cards.length ? `; cards drawn included ${listOf(cards)}` : ''}.`,
          citations: cite(g.list),
        });
      }
      return {
        evidence_sufficient: true,
        conclusion: `One way to read this: ${groups.map((g) => `${g.axis} comes up ${g.list.length === 1 ? 'once' : `${g.list.length} times`}`).join(', while ')}. The themes the journal tagged differ more than the questions do, which may say something about what each place stands for.`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    case 'recurring_cards': {
      const readings = byDate.filter((o) => o.type === 'reading' && o.cards.length);
      const counts = new Map<string, MockEvidenceObject[]>();
      for (const o of readings)
        for (const c of uniq(o.cards)) counts.set(c, [...(counts.get(c) ?? []), o]);
      const repeats = [...counts.entries()]
        .filter(([, l]) => l.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);
      if (readings.length < MIN_RELEVANT) return insufficient(all, readings, q);
      for (const [card, list] of repeats.slice(0, 4))
        claims.push({
          text: `${card} appeared ${list.length} times, on ${listOf(list.map(when), 3)}.`,
          citations: cite(list),
        });
      if (repeats.length === 0)
        claims.push({
          text: `Across these ${readings.length} readings (${listOf(readings.map(when), 3)}) no card was drawn more than once.`,
          citations: cite(readings),
        });
      return {
        evidence_sufficient: true,
        conclusion: repeats.length
          ? `Across ${readings.length} readings on this, ${listOf(repeats.slice(0, 3).map(([c]) => c))} ${repeats.length === 1 ? 'keeps' : 'keep'} coming back. A card that recurs may point to a question you are still circling rather than to any outcome.`
          : `Across ${readings.length} readings on this, no single card recurs; the questions repeat more than the cards do.`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    case 'change_over_time': {
      const mid = Math.ceil(byDate.length / 2);
      const early = byDate.slice(0, mid);
      const late = byDate.slice(mid);
      const et = themeCounts(early)
        .slice(0, 3)
        .map(([t]) => t);
      const lt = themeCounts(late)
        .slice(0, 3)
        .map(([t]) => t);
      claims.push({
        text: `Earlier (${listOf(early.map(when), 3)}): ${early.map(said).slice(0, 2).join('; ')}${et.length ? ` — tagged ${listOf(et)}` : ''}.`,
        citations: cite(early),
      });
      if (late.length)
        claims.push({
          text: `More recently (${listOf(late.map(when), 3)}): ${late.map(said).slice(0, 2).join('; ')}${lt.length ? ` — tagged ${listOf(lt)}` : ''}.`,
          citations: cite(late),
        });
      const withOutcome = byDate.filter(
        (o) => o.outcomes.length || o.links.some((l) => l.state === 'confirmed'),
      );
      if (withOutcome.length)
        claims.push({
          text: `You recorded what happened on ${withOutcome.length} of these (${listOf(withOutcome.map(when), 3)}).`,
          citations: cite(withOutcome),
        });
      const shifted = lt.filter((t) => !et.includes(t));
      return {
        evidence_sufficient: true,
        conclusion: `Between ${byDate[0]!.date} and ${byDate[byDate.length - 1]!.date} you came back to this ${byDate.length} times. ${shifted.length ? `The tags moved toward ${listOf(shifted, 2)}, which may suggest the question itself changed shape.` : 'The same themes run through the whole stretch, which may suggest the question has not yet changed shape.'}`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    case 'outcome_check': {
      const checked = byDate.filter(
        (o) =>
          o.type === 'reading' &&
          (o.outcomes.length || o.links.some((l) => l.state === 'confirmed')),
      );
      if (checked.length === 0)
        return {
          ...insufficient(all, relevant, q),
          found: `Found ${relevant.length} related readings (${listOf(relevant.map(when), 3)}), but no outcome or confirmed connection recorded on any of them yet.`,
          narrower_question: 'Which of my readings on this have no outcome recorded?',
        };
      for (const o of checked.slice(0, 5)) {
        const oc = o.outcomes[0];
        const link = o.links.find((l) => l.state === 'confirmed');
        claims.push({
          text: `${when(o)} ${said(o)} — ${oc ? `you recorded it as ${oc.status.replace(/_/g, ' ')}${oc.note ? ` (“${oc.note}”)` : ''}` : ''}${oc && link ? '; ' : ''}${link ? `you confirmed a connection to ${link.otherDate} “${link.otherTitle}”` : ''}.`,
          citations: [o.label],
        });
      }
      return {
        evidence_sufficient: true,
        conclusion: `Of ${relevant.length} readings on this, ${checked.length} ${checked.length === 1 ? 'has' : 'have'} something you later recorded against ${checked.length === 1 ? 'it' : 'them'}. Whether that counts as lining up is yours to judge — what follows is only what you recorded.`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    case 'first_occurrence': {
      const first = byDate[0]!;
      const rest = byDate.slice(1);
      const tag =
        q.keywords.map((k) => first.themes.find((t) => stem(t) === stem(k))).find(Boolean) ??
        q.keywords[0] ??
        'this';
      claims.push({
        text: `The earliest entry tagged with ${tag} is ${when(first)} ${said(first)}.`,
        citations: [first.label],
      });
      if (rest.length)
        claims.push({
          text: `It came back on ${listOf(rest.map(when), 4)}.`,
          citations: cite(rest),
        });
      return {
        evidence_sufficient: true,
        conclusion: `The first time ${tag} shows up in your journal is ${when(first)}, with ${said(first)}; it recurs ${rest.length} ${rest.length === 1 ? 'time' : 'times'} after that.`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    case 'unresolved': {
      const open = byDate.filter(
        (o) =>
          o.type === 'reading' &&
          (o.followUp === 'unresolved' || o.followUp === 'partly_resolved') &&
          o.outcomes.length === 0,
      );
      if (open.length < MIN_RELEVANT)
        return {
          ...insufficient(all, relevant, q),
          found: `Found ${open.length} open ${open.length === 1 ? 'reading' : 'readings'}; the rest have an outcome recorded.`,
        };
      const keys = new Map<string, MockEvidenceObject[]>();
      for (const o of open)
        for (const k of uniq([...o.entities, ...o.themes]))
          keys.set(k, [...(keys.get(k) ?? []), o]);
      const groups = [...keys.entries()]
        .filter(([, l]) => l.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);
      const used = new Set<string>();
      for (const [k, list] of groups) {
        if (list.every((o) => used.has(o.label))) continue;
        list.forEach((o) => used.add(o.label));
        claims.push({
          text: `${k}: asked ${list.length} times without an outcome recorded (${listOf(list.map(when), 3)}).`,
          citations: cite(list),
        });
        if (claims.length >= 4) break;
      }
      if (claims.length === 0)
        claims.push({
          text: `Open readings: ${listOf(
            open.map((o) => `${when(o)} ${said(o)}`),
            3,
          )}.`,
          citations: cite(open),
        });
      return {
        evidence_sufficient: true,
        conclusion: `${open.length} readings are still open. ${groups.length ? `The ones that repeat cluster around ${listOf(groups.slice(0, 2).map(([k]) => k))} — a question you may be asking the cards instead of settling.` : 'They do not share a person or a theme, so this may be less one loop than several.'}`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
    default: {
      for (const o of byDate.slice(0, 5))
        claims.push({
          text: `${when(o)} ${said(o)}${o.themes.length ? ` — tagged ${listOf(o.themes, 3)}` : ''}${o.cards.length ? `; cards: ${listOf(o.cards, 3)}` : ''}.`,
          citations: [o.label],
        });
      return {
        evidence_sufficient: true,
        conclusion: `Your history holds ${relevant.length} entries that seem to bear on this, from ${byDate[0]!.date} to ${byDate[byDate.length - 1]!.date}.`,
        claims,
        found: null,
        narrower_question: null,
      };
    }
  }
}
