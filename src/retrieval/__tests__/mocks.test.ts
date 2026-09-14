import { describe, expect, it } from 'vitest';
import { mockHistoryAnswer } from '@/ai/tasks/answer_from_evidence/mock';
import type { MockEvidenceObject } from '@/ai/tasks/answer_from_evidence';
import { mockHistoryQuery } from '@/ai/tasks/parse_history_query/mock';
import { historyAnswerSchema, verifyAnswer } from '@/domain/retrieval/answer';
import { EXAMPLE_QUESTIONS, historyQuerySchema } from '@/domain/retrieval/query';

/**
 * The mock parser and answerer are what the e2e suite and `pnpm eval --dry` run on; these
 * pin the parse of the six benchmark questions and the answerer's discipline: it cites only
 * labels it was given, and it says "not enough evidence" when fewer than two entries bear
 * on the question.
 */
const parse = (question: string) =>
  mockHistoryQuery({
    task: 'parse_history_query',
    system: '',
    messages: [],
    mockInput: { question, today: '2026-09-14' },
  });

describe('mock parse_history_query', () => {
  it('parses the six §6.6 questions into the intended intents and hints', () => {
    const parsed = EXAMPLE_QUESTIONS.map(parse);
    for (const p of parsed) expect(historyQuerySchema.safeParse(p).success).toBe(true);
    expect(parsed.map((p) => p.intent)).toEqual([
      'change_over_time',
      'recurring_cards',
      'compare',
      'outcome_check',
      'first_occurrence',
      'unresolved',
    ]);
    expect(parsed[0]!.time_range).toEqual({ start: '2026-06-01', end: null });
    expect(parsed[0]!.life_area).toBe('relationships');
    expect(parsed[1]!.life_area).toBe('work');
    expect(parsed[2]!.comparison_axes).toEqual(['Bali', 'Thailand']);
    expect(parsed[2]!.entity_hints).toEqual(['Bali', 'Thailand']);
    expect(parsed[4]!.keywords).toContain('independence');
    expect(parsed[5]!.keywords).toEqual([]);
  });

  it('names people and periods; a month with no entries is still a range', () => {
    expect(parse('What did my readings say about Priya?').entity_hints).toEqual(['Priya']);
    expect(parse('What did I ask about in January?').time_range).toEqual({
      start: '2026-01-01',
      end: '2026-01-31',
    });
    expect(parse('Did the Tower show up when I asked about Sam?').card_hints).toEqual([
      'the Tower',
    ]);
  });
});

const obj = (over: Partial<MockEvidenceObject> & { label: string }): MockEvidenceObject => ({
  type: 'reading',
  date: '2026-06-01',
  title: 'What is going on with Maya?',
  noteExcerpt: null,
  lifeArea: 'Relationships',
  cards: ['The Star'],
  themes: ['Distance'],
  entities: ['Maya'],
  journeys: [],
  followUp: 'unresolved',
  outcomes: [],
  links: [],
  ...over,
});
const answer = (question: string, objects: MockEvidenceObject[]) =>
  mockHistoryAnswer({
    task: 'answer_from_evidence',
    system: '',
    messages: [],
    mockInput: { question, query: parse(question), objects },
  });

describe('mock answer_from_evidence', () => {
  it('cites only labels from the package and passes verification', () => {
    const objects = [
      obj({ label: 'E1' }),
      obj({ label: 'E2', date: '2026-07-01', cards: ['The Star', 'Death'] }),
      obj({ label: 'E3', date: '2026-08-01', cards: ['The Star'] }),
    ];
    const a = answer('What cards keep appearing when I ask about Maya?', objects);
    expect(historyAnswerSchema.safeParse(a).success).toBe(true);
    expect(a.evidence_sufficient).toBe(true);
    const v = verifyAnswer(a, new Set(['E1', 'E2', 'E3']));
    expect(v.grounded).toBe(true);
    expect(v.stripped).toEqual([]);
    expect(a.claims[0]!.text).toMatch(/The Star appeared 3 times/);
  });

  it('a person who appears once → not enough evidence, with what was found', () => {
    const a = answer('What did my readings say about Priya?', [
      obj({ label: 'E1', entities: ['Priya'] }),
      obj({ label: 'E2' }),
    ]);
    expect(a.evidence_sufficient).toBe(false);
    expect(a.claims).toEqual([]);
    expect(a.found).toMatch(/Found 1 entry that mentions Priya/);
    expect(a.narrower_question).toBeTruthy();
  });

  it('an empty package → not enough evidence', () => {
    const a = answer('What did I ask about in January?', []);
    expect(a.evidence_sufficient).toBe(false);
    expect(a.found).toMatch(/Nothing in your history matched/);
  });

  it('a comparison with one side missing is honest about which side', () => {
    const a = answer('Compare my readings about Bali and Thailand.', [
      obj({ label: 'E1', title: 'Should I go to Bali?', entities: ['Bali'] }),
      obj({ label: 'E2', title: 'Bali again?', entities: ['Bali'] }),
    ]);
    expect(a.evidence_sufficient).toBe(false);
    expect(a.found).toMatch(/none about Thailand/);
  });

  it('never uses certainty language', () => {
    const objects = [obj({ label: 'E1' }), obj({ label: 'E2', date: '2026-07-01' })];
    for (const q of EXAMPLE_QUESTIONS) {
      const a = answer(q, objects);
      expect(
        verifyAnswer(a, new Set(['E1', 'E2'])).issues.filter((i) => i.startsWith('register')),
      ).toEqual([]);
    }
  });
});
