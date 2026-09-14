/**
 * Rule-based event extractor for the mock provider: the reading extractor's rules over the
 * event's sentence and note, plus an event type and importance by keyword. Enough to drive
 * the whole loop — extraction, journeys, correlation, review — without a model.
 */
import type { FixtureRequest } from '../../providers/mock';
import { mockExtraction } from '../extract_reading_metadata/mock';
import type { EventExtractionPayload } from './schema';

const TYPE_RULES: { type: EventExtractionPayload['event_type']; re: RegExp }[] = [
  {
    type: 'relationship',
    re: /\b(girlfriend|boyfriend|partner|broke up|break-?up|take a break|date|dinner with|ex|proposed|engaged|moved in|talked about|the conversation)\b/i,
  },
  {
    type: 'work',
    re: /\b(job|offer|promotion|contract|agency|office|team|role|hired|resigned|interview|client|conference|talk)\b/i,
  },
  { type: 'home', re: /\b(flat|house|home|landlord|lease|moved|move to|keys|viewing)\b/i },
  {
    type: 'health',
    re: /\b(doctor|health|sleep|hospital|ill|sick|diagnos|scan|therapy|walk|run)\b/i,
  },
  { type: 'money', re: /\b(money|paid|debt|loan|salary|raise|tax|savings)\b/i },
  {
    type: 'family',
    re: /\b(mum|mom|dad|brother|sister|parents|family|anniversary|grandma|gran)\b/i,
  },
  { type: 'travel', re: /\b(trip|flight|travel|holiday|train to|weekend in)\b/i },
  { type: 'learning', re: /\b(course|workshop|class|exam|learned|studied)\b/i },
  { type: 'loss', re: /\b(died|passed away|funeral|lost|grief)\b/i },
  { type: 'milestone', re: /\b(birthday|wedding|graduated|signed|launched|finished the)\b/i },
];

const IMPORTANCE_RULES: { level: number; re: RegExp }[] = [
  {
    level: 5,
    re: /\b(died|passed away|wedding|proposed|engaged|diagnos|born|accepted the job|quit|resigned|broke up|signed the)\b/i,
  },
  { level: 4, re: /\b(offer|moved|move to|hired|promotion|funeral|interview|launched)\b/i },
  { level: 2, re: /\b(dinner|coffee|walk|call|called|texted|chat|lunch)\b/i },
];

/** Event verbs the reading rules never see ("accepted the job", "we talked"). */
const EVENT_THEME_RULES: {
  label: string;
  category: 'emotional' | 'relational' | 'situational' | 'practical';
  re: RegExp;
}[] = [
  {
    label: 'Decision',
    category: 'situational',
    re: /\b(accepted|said yes|said no|signed|decided|handed in|resigned|quit)\b/i,
  },
  {
    label: 'Ambition',
    category: 'practical',
    re: /\b(job|offer|role|promotion|hired|conference|talk|review)\b/i,
  },
  {
    label: 'Communication',
    category: 'relational',
    re: /\b(talked|conversation|told|called|phone call|texted)\b/i,
  },
  {
    label: 'Change',
    category: 'situational',
    re: /\b(moved|new team|first week|first day|started|keys)\b/i,
  },
  {
    label: 'Endings',
    category: 'situational',
    re: /\b(broke up|take a break|ended|left|handed in my notice|resigned)\b/i,
  },
];

export function mockEventExtraction(req: FixtureRequest): EventExtractionPayload {
  const description = String(req.mockInput?.description ?? '');
  const note = (req.mockInput?.note as string | null) ?? null;
  const base = mockExtraction({
    ...req,
    mockInput: { question: null, notes: [description, note].filter(Boolean).join(' ') },
  });
  const text = `${description} ${note ?? ''}`;
  const event_type = TYPE_RULES.find((r) => r.re.test(text))?.type ?? null;
  const importance = IMPORTANCE_RULES.find((r) => r.re.test(text))?.level ?? 3;
  const themes = [...base.themes];
  for (const rule of EVENT_THEME_RULES) {
    if (!rule.re.test(text) || themes.some((t) => t.label === rule.label)) continue;
    themes.push({ label: rule.label, category: rule.category, weight: 0.65 });
  }
  return {
    ...base,
    themes: themes.slice(0, 5),
    timeframe: null,
    possibilities: [],
    event_mentions: [{ text: description.slice(0, 400), when: null }],
    event_type,
    importance,
  };
}
