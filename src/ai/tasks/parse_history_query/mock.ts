/**
 * Rule-based parser for the mock provider: enough to drive the whole Ask pipeline — the
 * six benchmark questions and the two adversarial ones — without a model. Not the product's
 * parser; the real task is the model. Reads the same question the prompt carries.
 */
import { LIFE_AREAS } from '@/domain/readings/types';
import { resolveTimePhrase, type HistoryQuery } from '@/domain/retrieval/query';
import type { FixtureRequest } from '../../providers/mock';

const AREA_WORDS: Record<(typeof LIFE_AREAS)[number]['key'], RegExp> = {
  relationships: /\b(relationship|relationships|partner|girlfriend|boyfriend|dating|love|ex)\b/i,
  work: /\b(job|work|career|agency|role|team|boss|office|promotion|review|contract)\b/i,
  money: /\b(money|finances|debt|spending|savings|tax)\b/i,
  health: /\b(health|sleep|body|routine|doctor|energy)\b/i,
  home: /\b(home|flat|house|move|moving|landlord)\b/i,
  creativity: /\b(creative|creativity|side project|writing|workshop)\b/i,
  self: /\b(myself|self|independence|independent|identity|confidence)\b/i,
  family: /\b(family|brother|sister|dad|mum|mom|parents)\b/i,
};

const CARD_RE =
  /\b((?:ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king|prince|princess) of (?:cups|wands|swords|pentacles|disks)|the fool|the magician|the magus|the high priestess|the priestess|the empress|the emperor|the hierophant|the lovers|the chariot|strength|lust|the hermit|wheel of fortune|fortune|justice|adjustment|the hanged man|death|temperance|art|the devil|the tower|the star|the moon|the sun|judgement|the aeon|the world|the universe)\b/gi;

const STOP = new Set(
  'a an the and or but if of to in on at for from with about my me i we our your you what which when where how did do does have has had any is are was were be been keep keeps kept without since compare comparing readings reading cards card themes theme ask asking asked questions question start started getting get first later happened happen line lined up old change changed changing resolving resolve resolved without keep keeps kept appearing appear coming showing this that these those last summer winter spring autumn fall year month week'.split(
    ' ',
  ),
);
const MONTHS =
  /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

function intentOf(q: string): HistoryQuery['intent'] {
  if (/\bcompare|versus|\bvs\b|side by side/i.test(q)) return 'compare';
  if (/\b(keep|keeps) (appearing|coming up|showing up)|recur|again and again|most often/i.test(q))
    return 'recurring_cards';
  if (
    /\b(line|lined) up|what later happened|came true|turned out|did .* happen|actually happened|outcome/i.test(
      q,
    )
  )
    return 'outcome_check';
  if (/\bfirst\b|\bwhen did i (start|begin)/i.test(q)) return 'first_occurrence';
  if (/\bwithout resolving|unresolved|never resolve|keep asking|open question/i.test(q))
    return 'unresolved';
  if (/\bhow (have|has|did) .* (change|changed|evolve|shift)|over time|since\b/i.test(q))
    return 'change_over_time';
  if (/\bwhat did|show me|find|which readings|when did/i.test(q)) return 'lookup';
  return 'other';
}

export function mockHistoryQuery(req: FixtureRequest): HistoryQuery {
  const question = String(req.mockInput?.question ?? '');
  const today = String(req.mockInput?.today ?? new Date().toISOString().slice(0, 10));
  const intent = intentOf(question);
  const time_range = resolveTimePhrase(question, today);
  const life_area =
    (Object.entries(AREA_WORDS).find(([, re]) => re.test(question))?.[0] as
      HistoryQuery['life_area'] | undefined) ?? null;

  const card_hints = [...question.matchAll(CARD_RE)].map((m) => m[1]!);
  const cardSet = new Set(card_hints.map((c) => c.toLowerCase()));

  // Capitalised words that are not sentence-initial, months or card names are names.
  const entity_hints: string[] = [];
  const words = question
    .replace(/[?.!,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  words.forEach((w, i) => {
    if (i === 0 || !/^[A-Z][a-z]+$/.test(w) || MONTHS.test(w) || cardSet.has(w.toLowerCase()))
      return;
    if (!entity_hints.includes(w)) entity_hints.push(w);
  });
  for (const m of question.matchAll(
    /\b(?:the|my)\s+(agency|company|firm|office|studio|team|club)\b/gi,
  ))
    if (!entity_hints.includes(m[0])) entity_hints.push(m[0]);

  const comparison_axes =
    intent === 'compare'
      ? entity_hints.length >= 2
        ? entity_hints.slice(0, 4)
        : [...question.matchAll(/\babout\s+([\w ]+?)\s+and\s+([\w ]+?)(?:\s*[?.]|$)/gi)]
            .flatMap((m) => [m[1]!, m[2]!])
            .slice(0, 4)
      : [];

  const journey_hints: string[] = [];
  const jm = question.match(
    /\b(?:about|when i ask about)\s+((?:leaving|moving|starting|the move|the job|my job)[\w ]{0,30}?)(?:\s*[?.]|$)/i,
  );
  if (jm) journey_hints.push(jm[1]!.trim());

  const keywords: string[] = [];
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (w.length < 4 || STOP.has(w) || MONTHS.test(w) || cardSet.has(w)) continue;
    if (entity_hints.some((e) => e.toLowerCase() === w)) continue;
    if (!keywords.includes(w)) keywords.push(w);
    if (keywords.length >= 8) break;
  }

  const object_types: HistoryQuery['object_types'] = /\b(happened|events?|what later)\b/i.test(
    question,
  )
    ? ['reading', 'life_event']
    : /\b(readings?|cards?|spread)\b/i.test(question)
      ? ['reading']
      : ['reading', 'life_event'];

  return {
    intent,
    time_range,
    life_area,
    entity_hints: entity_hints.slice(0, 6),
    journey_hints: journey_hints.slice(0, 4),
    card_hints: card_hints.slice(0, 8),
    comparison_axes,
    object_types,
    keywords,
  };
}
