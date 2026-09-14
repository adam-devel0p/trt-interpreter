import { describe, expect, it } from 'vitest';
import {
  citedLabels,
  historyAnswerSchema,
  insufficientAnswer,
  verifyAnswer,
  type HistoryAnswer,
} from '../answer';
import { labelEvidence, renderEvidence, type EvidenceObject } from '../evidence';

const labels = new Set(['E1', 'E2', 'E3']);
const answer = (over: Partial<HistoryAnswer> = {}): HistoryAnswer => ({
  evidence_sufficient: true,
  conclusion: 'One way to read this is that the question changed shape.',
  claims: [{ text: 'You asked twice in June.', citations: ['E1', 'E2'] }],
  found: null,
  narrower_question: null,
  ...over,
});

describe('verifyAnswer (step 7)', () => {
  it('passes a fully cited answer untouched', () => {
    const v = verifyAnswer(answer(), labels);
    expect(v.grounded).toBe(true);
    expect(v.stripped).toEqual([]);
    expect(v.answer).toEqual(answer());
  });

  it('strips a fabricated citation and keeps the claim when another citation remains', () => {
    const v = verifyAnswer(answer({ claims: [{ text: 'x', citations: ['E1', 'E9'] }] }), labels);
    expect(v.stripped).toEqual(['E9']);
    expect(v.answer.claims[0]!.citations).toEqual(['E1']);
    expect(v.grounded).toBe(true);
    expect(v.issues).toEqual(['unknown citation']);
  });

  it('a claim left with no citation is not grounded', () => {
    const v = verifyAnswer(answer({ claims: [{ text: 'x', citations: ['E9'] }] }), labels);
    expect(v.grounded).toBe(false);
    expect(v.issues).toContain('uncited claim');
  });

  it('a "sufficient" answer with no cited claim is not grounded; an insufficient one may have none', () => {
    expect(verifyAnswer(answer({ claims: [] }), labels).grounded).toBe(false);
    expect(verifyAnswer(answer({ evidence_sufficient: false, claims: [] }), labels).grounded).toBe(
      true,
    );
  });

  it('certainty language fails the register check', () => {
    const v = verifyAnswer(
      answer({ conclusion: 'You will definitely get the job, 90% sure.' }),
      labels,
    );
    expect(v.grounded).toBe(false);
    expect(v.issues.filter((i) => i.startsWith('register')).length).toBeGreaterThanOrEqual(2);
  });

  it('the schema requires citation labels of the E<n> form and bounds the lists', () => {
    expect(
      historyAnswerSchema.safeParse(answer({ claims: [{ text: 'x', citations: ['reading-123'] }] }))
        .success,
    ).toBe(false);
    expect(
      historyAnswerSchema.safeParse(
        answer({ claims: Array.from({ length: 9 }, () => ({ text: 'x', citations: ['E1'] })) }),
      ).success,
    ).toBe(false);
  });

  it('the fallback is explicit about what was found', () => {
    const a = insufficientAnswer('Found 3 readings but none about Priya.', 'What did I ask most?');
    expect(a.evidence_sufficient).toBe(false);
    expect(a.claims).toEqual([]);
    expect(historyAnswerSchema.safeParse(a).success).toBe(true);
    expect(
      citedLabels(
        answer({
          claims: [
            { text: 'a', citations: ['E2', 'E1'] },
            { text: 'b', citations: ['E1'] },
          ],
        }),
      ),
    ).toEqual(['E2', 'E1']);
  });
});

describe('evidence rendering', () => {
  const o: EvidenceObject = {
    id: 'r1',
    type: 'reading',
    date: '2026-06-06',
    title: 'What does Maya need from me right now?',
    noteExcerpt: 'Maya wants a conversation, not a plan.',
    lifeArea: 'Relationships',
    eventType: null,
    deck: 'Thoth',
    cards: [{ name: 'Princess of Cups', orientation: 'upright', position: 'Present' }],
    themes: ['Distance'],
    entities: ['Maya'],
    journeys: ['Me and Maya'],
    possibilities: ['There may be more than one way to talk.'],
    timeframe: null,
    followUp: 'partly_resolved',
    outcomes: [
      { status: 'partly', note: 'We talked.', recordedOn: '2026-06-20', eventTitle: null },
    ],
    links: [
      {
        otherType: 'life_event',
        otherId: 'e1',
        otherTitle: 'Maya and I had the conversation.',
        otherDate: '2026-06-11',
        state: 'confirmed',
      },
    ],
  };
  it('labels derived fields as derived, records as the user’s, and links by their state', () => {
    const text = renderEvidence(o, 'E1');
    expect(text).toMatchInlineSnapshot(`
      "[E1] Reading · 2026-06-06 · in: Me and Maya
        Question: “What does Maya need from me right now?”
        Cards (Thoth): Princess of Cups as Present
        Their note: “Maya wants a conversation, not a plan.”
        Life area: Relationships
        Themes (derived): Distance
        Mentions: Maya
        Possibilities noted (derived, not facts): There may be more than one way to talk.
        Follow-up status: partly resolved
        Outcome recorded by the user (2026-06-20): partly — “We talked.”
        Connection confirmed by the user: event 2026-06-11 “Maya and I had the conversation.”"
    `);
    const [l] = labelEvidence([o]);
    expect(l!.label).toBe('E1');
    expect(l!.tokens).toBeGreaterThan(50);
  });
});

describe('covering summaries are never the sole support (Phase 10, §19)', () => {
  it('drops a claim that cites only summary labels and keeps one that also cites an entry', () => {
    const labels = new Set(['E1', 'E2', 'E3']);
    const out = verifyAnswer(
      {
        evidence_sufficient: true,
        conclusion: 'You asked about work most in August.',
        claims: [
          { text: 'August was mostly about work.', citations: ['E3'] },
          { text: 'The 3 August reading asked about the agency.', citations: ['E1', 'E3'] },
        ],
        found: null,
        narrower_question: null,
      },
      labels,
      { summaryLabels: new Set(['E3']) },
    );
    expect(out.answer.claims).toEqual([
      { text: 'The 3 August reading asked about the agency.', citations: ['E1', 'E3'] },
    ]);
    expect(out.issues).toContain('summary-only claim');
    expect(out.grounded).toBe(true);
    const only = verifyAnswer(
      {
        evidence_sufficient: true,
        conclusion: 'x',
        claims: [{ text: 'a', citations: ['E3'] }],
        found: null,
        narrower_question: null,
      },
      labels,
      { summaryLabels: new Set(['E3']) },
    );
    expect(only.grounded).toBe(false);
    expect(only.issues).toContain('no cited claim');
  });
});
