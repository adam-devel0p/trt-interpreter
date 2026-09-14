/**
 * Rule-based extractor for the mock provider: enough to exercise the whole structured-memory
 * path — resolution, chips, corrections, merge, reprocessing — end to end without a model.
 * Not the product's extractor; the real task is the model. It reads the same text the prompt
 * carries and proposes mentions by surface form only (descriptors, capitalised names,
 * initials, places after a preposition), themes by keyword, possibilities from the question.
 */
import type { ExtractionPayload } from '@/domain/extraction/schema';
import { RELATION_ROLES } from '@/domain/entities/relations';
import type { FixtureRequest } from '../../providers/mock';

type Entity = ExtractionPayload['entities'][number];
type Theme = ExtractionPayload['themes'][number];

const DESCRIPTOR_ROLE = new Map<string, { role: string; kind: Entity['kind'] }>();
for (const r of RELATION_ROLES)
  for (const t of r.terms)
    DESCRIPTOR_ROLE.set(t.replace(/^the /, ''), { role: r.role, kind: r.kind });

const ORG_WORDS = [
  'agency',
  'company',
  'firm',
  'office',
  'studio',
  'team',
  'club',
  'school',
  'clinic',
];
const EMPLOYER_WORDS = new Set(['agency', 'company', 'firm', 'office', 'studio']);
const PLACE_PREP =
  /\b(?:in|from|near|(?:move|moving|moved|go|going|went|back|trip|flight|drive|drove|relocate|relocating|off|down|up|over|train|road)\s+to)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/g;
const MOVE_VERBS = new Set([
  'move',
  'moving',
  'moved',
  'go',
  'going',
  'went',
  'back',
  'trip',
  'flight',
  'drive',
  'drove',
  'relocate',
  'relocating',
  'off',
  'down',
  'up',
  'over',
  'train',
  'road',
]);
const STOP = new Set([
  'I',
  'The',
  'A',
  'An',
  'And',
  'But',
  'Or',
  'If',
  'What',
  'How',
  'Will',
  'Should',
  'Is',
  'Are',
  'Do',
  'Does',
  'Where',
  'When',
  'Why',
  'Take',
  'Same',
  'Path',
  'Trying',
  'Drew',
  'Found',
  'Quiet',
  'Nine',
  'Ten',
  'Eight',
  'Seven',
  'Six',
  'Five',
  'Four',
  'Three',
  'Two',
  'Ace',
  'King',
  'Queen',
  'Knight',
  'Page',
  'Prince',
  'Princess',
  'Cups',
  'Wands',
  'Swords',
  'Pentacles',
  'Disks',
  'Temperance',
  'Star',
  'Tower',
  'Hermit',
  'Justice',
  'Adjustment',
  'Lust',
  'Strength',
  'Universe',
  'World',
  'Aeon',
  'Peace',
  'Ruin',
  'Strife',
  'Works',
  'Wealth',
  'Advice',
  'Past',
  'Present',
  'Future',
  'Beneath',
  'Above',
  'Between',
  'Revisit',
  'Noted',
  'Yes',
  'No',
  'Not',
  'Money',
  'Money.',
  'Slow',
  'Stop',
  'Someone',
  'Something',
  'Two',
  'Deleted',
  'This',
  'That',
  'Used',
  'First',
  'Back',
  'Waite',
  'Thoth',
  'Rider',
  'Friday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

const THEME_RULES: { slug: string; label: string; category: Theme['category']; re: RegExp }[] = [
  {
    slug: 'decision',
    label: 'Decision',
    category: 'situational',
    re: /\b(should i|or stay|take the offer|decide|decision|choice|say yes|yes to|worth)\b/i,
  },
  {
    slug: 'uncertainty',
    label: 'Uncertainty',
    category: 'emotional',
    re: /\b(not sure|unsure|don't know|do not know|whether|what am i not seeing|really|honestly|what do i need to know)\b/i,
  },
  {
    slug: 'change',
    label: 'Change',
    category: 'situational',
    re: /\b(move|moving|new (team|routine|role|chapter)|change|transition|shape of this year|year ahead)\b/i,
  },
  {
    slug: 'endings',
    label: 'Endings',
    category: 'situational',
    re: /\b(leaving|left|walking away|walking-away|closing|ending|finished|move-out|list the house)\b/i,
  },
  {
    slug: 'anxiety',
    label: 'Anxiety',
    category: 'emotional',
    re: /\b(worry|worried|stress|anxious|avoiding|nervous|review)\b/i,
  },
  {
    slug: 'money_pressure',
    label: 'Money pressure',
    category: 'practical',
    re: /\b(money|spending|debt|afford|tax|offer on the house|fair)\b/i,
  },
  {
    slug: 'conflict',
    label: 'Conflict',
    category: 'relational',
    re: /\b(tension|argument|fight|strife|unresolved between|conflict)\b/i,
  },
  {
    slug: 'communication',
    label: 'Communication',
    category: 'relational',
    re: /\b(conversation|talk|talking|say less|say yes|tell|ask)\b/i,
  },
  {
    slug: 'distance',
    label: 'Distance',
    category: 'relational',
    re: /\b(distance|far away|apart|alive from)\b/i,
  },
  {
    slug: 'stability',
    label: 'Stability',
    category: 'situational',
    re: /\b(routine|ground|steady|stick|settle|balance)\b/i,
  },
  {
    slug: 'health',
    label: 'Health',
    category: 'practical',
    re: /\b(health|sleep|body|slow down|tired|energy)\b/i,
  },
  {
    slug: 'work_life',
    label: 'Work and life',
    category: 'practical',
    re: /\b(evenings|side project|work-life|overwork|burnout|weekend)\b/i,
  },
  {
    slug: 'home',
    label: 'Home',
    category: 'practical',
    re: /\b(flat|house|home|viewing|landlord|move to)\b/i,
  },
  {
    slug: 'family',
    label: 'Family',
    category: 'relational',
    re: /\b(brother|sister|dad|mum|mom|father|mother|family|anniversary|parents)\b/i,
  },
  {
    slug: 'ambition',
    label: 'Ambition',
    category: 'practical',
    re: /\b(apply|role|lead|promotion|offer|contract|talk at|conference|focus on)\b/i,
  },
  {
    slug: 'care',
    label: 'Care',
    category: 'relational',
    re: /\b(support|look after|taking over|help|softer)\b/i,
  },
  {
    slug: 'confidence',
    label: 'Confidence',
    category: 'emotional',
    re: /\b(confidence|confident|stop waiting to be asked|already decided)\b/i,
  },
  {
    slug: 'hope',
    label: 'Hope',
    category: 'emotional',
    re: /\b(hope|hopeful|looking forward|the star)\b/i,
  },
  {
    slug: 'patience',
    label: 'Patience',
    category: 'situational',
    re: /\b(slow|wait|patience|take time|revisit)\b/i,
  },
  {
    slug: 'creativity',
    label: 'Creativity',
    category: 'practical',
    re: /\b(workshop|creative|writing|making|project)\b/i,
  },
  {
    slug: 'independence',
    label: 'Independence',
    category: 'situational',
    re: /\b(independence|independent|on my own|my own terms|by myself|freedom|self-reliance)\b/i,
  },
];

const AREA_BY_THEME: Record<string, string> = {
  money_pressure: 'money',
  home: 'home',
  family: 'family',
  health: 'health',
  work_life: 'work',
  ambition: 'work',
  creativity: 'creativity',
  conflict: 'relationships',
  distance: 'relationships',
  communication: 'relationships',
};

const TIMEFRAME_RE =
  /\b(this (?:week|month|year|spring|summer|autumn|winter|weekend|evening)|next (?:week|month|year|three months|few months|few weeks)|the (?:year|month|week) ahead|the next (?:three|few) (?:months|weeks)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:by|before|after) (?:the )?(?:review|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|christmas|new year|summer|spring|autumn|winter|end of (?:the )?(?:month|year|week))|in (?:a|two|three) (?:week|month|year)s?|tonight|tomorrow|this spring|this autumn)\b/i;

const TONE_RULES: { tone: string; re: RegExp }[] = [
  { tone: 'worried', re: /\b(worry|worried|anxious|stress|avoiding|afraid)\b/i },
  { tone: 'hopeful', re: /\b(hope|hopeful|confidence|quiet confidence|opens more)\b/i },
  { tone: 'tired', re: /\b(tired|slow down|exhausted)\b/i },
  { tone: 'sad', re: /\b(sad|grief|loss|mourning)\b/i },
  { tone: 'calm', re: /\b(calm|quiet morning|peace|noted)\b/i },
  { tone: 'unsettled', re: /\b(strange|tension|not seeing|circling)\b/i },
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function clauseFor(text: string, needle: string): string | null {
  const s = sentences(text).find((x) => x.toLowerCase().includes(needle.toLowerCase()));
  return s ? s.slice(0, 200) : null;
}

function extractEntities(text: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  const push = (e: Entity) => {
    const key = e.mention.toLowerCase().replace(/^(my|our|the)\s+/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  // "my girlfriend", "our landlord", "my old agency", "my ex", "my ex-girlfriend"
  for (const m of text.matchAll(/\b(my|our)\s+([a-z][a-z-]+)(?:\s+([a-z][a-z-]+))?/gi)) {
    const first = m[2]!.toLowerCase();
    const second = (m[3] ?? '').toLowerCase();
    const two = second ? `${first} ${second}` : '';
    const hit =
      (two && DESCRIPTOR_ROLE.has(two) && { key: two, mention: `${m[1]} ${m[2]} ${m[3]}` }) ||
      (DESCRIPTOR_ROLE.has(first) && { key: first, mention: `${m[1]} ${m[2]}` }) ||
      null;
    if (hit) {
      const desc = DESCRIPTOR_ROLE.get(hit.key)!;
      push({
        mention: hit.mention,
        kind: desc.kind,
        confidence: 0.85,
        relation: desc.role.replace('_', '-'),
        context: clauseFor(text, hit.mention),
      });
      continue;
    }
    const qualifier = ['old', 'new'].includes(first) ? first : '';
    const word = qualifier ? second : first;
    if (ORG_WORDS.includes(word)) {
      const mention = qualifier ? `${m[1]} ${m[2]} ${m[3]}` : `${m[1]} ${m[2]}`;
      push({
        mention,
        kind: 'organization',
        confidence: 0.7,
        relation: EMPLOYER_WORDS.has(word)
          ? qualifier === 'old'
            ? 'former employer'
            : 'employer'
          : null,
        context: clauseFor(text, mention),
      });
    }
  }
  // "the agency", "the new team", "the old company"
  for (const m of text.matchAll(
    /\b(the)\s+((?:old|new)\s)?(agency|company|firm|office|studio|team|club|school|clinic)\b/gi,
  )) {
    const word = m[3]!.toLowerCase();
    const qualifier = (m[2] ?? '').trim().toLowerCase();
    push({
      mention: m[0],
      kind: 'organization',
      confidence: 0.7,
      relation: EMPLOYER_WORDS.has(word)
        ? qualifier === 'old'
          ? 'former employer'
          : 'employer'
        : null,
      context: clauseFor(text, m[0]),
    });
  }
  // Standalone kin names: "Dad", "Mum".
  for (const m of text.matchAll(/\b(Mum|Mom|Dad|Gran|Nan)\b/g)) {
    const desc = DESCRIPTOR_ROLE.get(m[1]!.toLowerCase())!;
    push({
      mention: m[1]!,
      kind: 'person',
      confidence: 0.8,
      relation: desc.role,
      context: clauseFor(text, m[1]!),
    });
  }
  // Initials ("M.", "J.", "R.") and capitalised names not at a sentence start.
  for (const s of sentences(text)) {
    const words = s.split(/\s+/);
    words.forEach((raw, i) => {
      const initial = raw.match(/^([A-Z])\.[?!,.]*$/);
      if (initial && i > 0) {
        push({
          mention: `${initial[1]}.`,
          kind: 'person',
          confidence: 0.6,
          relation: null,
          context: s.slice(0, 200),
        });
        return;
      }
      const w = raw.replace(/[^A-Za-z'’-]/g, '');
      if (!w || !/^[A-Z][a-z]+$/.test(w) || STOP.has(w)) return;
      const next = (words[i + 1] ?? '').toLowerCase();
      // A sentence-initial capital is a name only when a verb or "my …" follows it.
      if (
        i === 0 &&
        !/^(said|says|told|asked|called|texted|rang|came|left|thinks|thought|is|was|has|had|will|wants|needs|and|my|our)$/.test(
          next,
        )
      )
        return;
      const prev = words[i - 1]?.toLowerCase() ?? '';
      if (['the', 'of', 'a', 'an'].includes(prev)) return;
      // A place cue ("in Lisbon", "move to Leeds") is left for the places pass.
      const prev2 = words[i - 2]?.toLowerCase() ?? '';
      if (['in', 'from', 'near'].includes(prev) || (prev === 'to' && MOVE_VERBS.has(prev2))) return;
      if (
        i === 0 ||
        /^(with|and|about|from|for|to|at|by|on|,)$/.test(prev) ||
        prev.endsWith(',') ||
        /^(?:[a-z]+)$/.test(prev)
      ) {
        const relation = text.match(new RegExp(`${w},?\\s+my\\s+([a-z]+)`, 'i'))?.[1] ?? null;
        push({
          mention: w,
          kind: 'person',
          confidence: 0.6,
          relation:
            relation && DESCRIPTOR_ROLE.has(relation) ? DESCRIPTOR_ROLE.get(relation)!.role : null,
          context: s.slice(0, 200),
        });
      }
    });
  }
  // Places after a preposition or a move: "in Lisbon", "move to Leeds". Names already found win.
  for (const m of text.matchAll(PLACE_PREP)) {
    const name = m[1]!;
    if (STOP.has(name) || STOP.has(name.split(' ')[0]!)) continue;
    push({
      mention: name,
      kind: 'place',
      confidence: 0.7,
      relation: null,
      context: clauseFor(text, name),
    });
  }
  return out.slice(0, 12);
}

function extractThemes(text: string): Theme[] {
  const hits: Theme[] = [];
  for (const rule of THEME_RULES) {
    const count = (text.match(new RegExp(rule.re.source, 'gi')) ?? []).length;
    if (count === 0) continue;
    hits.push({
      label: rule.label,
      category: rule.category,
      weight: Math.min(0.95, 0.5 + 0.15 * count),
    });
  }
  return hits.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

function extractPossibilities(question: string | null): ExtractionPayload['possibilities'] {
  if (!question) return [];
  const q = question.trim().replace(/\?$/, '');
  const tf = q.match(TIMEFRAME_RE)?.[0] ?? null;
  const will = q.match(/^will\s+(.+)$/i);
  if (will)
    return [
      {
        text: `${cap(will[1]!)} may come to pass.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      },
    ];
  const should = q.match(/^should (?:i|we)\s+(.+?)(?:\s+or\s+(.+))?$/i);
  if (should) {
    const out: ExtractionPayload['possibilities'] = [
      {
        text: `Choosing to ${should[1]!} may open something.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      },
    ];
    if (should[2])
      out.push({
        text: `Choosing to ${should[2]} may keep something.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      });
    return out;
  }
  const howWill = q.match(/^how will\s+(.+?)(?:\s+go)?$/i);
  if (howWill)
    return [
      {
        text: `${cap(howWill[1]!)} may go differently than expected.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      },
    ];
  const howDo = q.match(/^how (?:do|can|could) (?:i|we)\s+(.+)$/i);
  if (howDo)
    return [
      {
        text: `There may be more than one way to ${howDo[1]!}.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      },
    ];
  const is = q.match(/^is\s+(.+)$/i);
  if (is)
    return [
      {
        text: `${cap(is[1]!)} is one possibility the reading holds open.`,
        category: null,
        timeframe: tf,
        kind: 'possibility',
      },
    ];
  return [];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function mockExtraction(req: FixtureRequest): ExtractionPayload {
  const question = (req.mockInput?.question as string | null) ?? null;
  const notes = (req.mockInput?.notes as string | null) ?? null;
  const userArea = (req.mockInput?.lifeArea as string | null) ?? null;
  const text = [question, notes]
    .filter((t): t is string => !!t)
    .map((t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`))
    .join(' ');
  const entities = extractEntities(text);
  const themes = extractThemes(text);
  const inferredArea =
    themes
      .map((t) => AREA_BY_THEME[THEME_RULES.find((r) => r.label === t.label)!.slug])
      .find(Boolean) ??
    (entities.some((e) => ['partner', 'ex-partner', 'friend'].includes(e.relation ?? ''))
      ? 'relationships'
      : null);
  const tfText = text.match(TIMEFRAME_RE)?.[0] ?? null;
  const tone = TONE_RULES.find((r) => r.re.test(text))?.tone ?? null;
  const decisions = question && /^should (i|we)\b/i.test(question) ? [question.trim()] : [];
  const fears = [...text.matchAll(/\b(?:afraid|worried|scared) (?:that |of |about )?([^.?!]+)/gi)]
    .map((m) => m[1]!.trim())
    .slice(0, 3);
  const goals = [...text.matchAll(/\b(?:want to|hope to|trying to) ([^.?!,]+)/gi)]
    .map((m) => m[1]!.trim())
    .slice(0, 3);
  const place = entities.find((e) => e.kind === 'place');
  const org = entities.find((e) => e.kind === 'organization');
  const person = entities.find((e) => e.kind === 'person');
  const journey_candidates: ExtractionPayload['journey_candidates'] = [];
  if (place) journey_candidates.push({ title: `The move to ${place.mention}`, confidence: 0.55 });
  else if (org) journey_candidates.push({ title: `Work at ${org.mention}`, confidence: 0.5 });
  else if (person && person.relation)
    journey_candidates.push({ title: `Things with ${person.mention}`, confidence: 0.45 });
  return {
    life_area:
      (userArea as ExtractionPayload['life_area']) ??
      (inferredArea as ExtractionPayload['life_area']) ??
      null,
    entities,
    themes,
    event_mentions: [],
    goals,
    fears,
    decisions,
    timeframe: tfText ? { start: null, end: null, text: tfText } : null,
    possibilities: extractPossibilities(question),
    emotional_tone: tone,
    journey_candidates,
    safety_flags: [],
  };
}
