import { describe, expect, it } from 'vitest';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import { SPREADS } from '@/db/seed/decks/spreads';
import { bannedTerms, deckVocabulary } from '@/domain/decks/purity';
import { selectDepth } from '@/domain/interpretation/depth';
import { findRegisterViolations } from '@/domain/interpretation/register';
import { modelInterpretationSchema } from '@/domain/interpretation/schema';
import { NO_FLAG } from '@/domain/safety/categories';
import type { DeckSeed } from '@/domain/decks/types';
import { mockSafety } from '@/ai/tasks/classify_safety/mock';
import { buildSafetyRequest } from '@/ai/tasks/classify_safety';
import {
  allText,
  buildInterpretRequest,
  resolveCardIds,
  validateInterpretation,
  type InterpretReadingInput,
} from '@/ai/tasks/interpret_reading';
import { mockInterpretation } from '@/ai/tasks/interpret_reading/mock';
import { systemPrompt, userPrompt } from '@/ai/tasks/interpret_reading/prompt';

const rwsV = deckVocabulary(RWS_DECK);
const thothV = deckVocabulary(THOTH_DECK);

function input(
  deck: DeckSeed,
  slugs: string[],
  over: Partial<InterpretReadingInput> = {},
): InterpretReadingInput {
  const spread = SPREADS.find((s) => s.positions.length === slugs.length)!;
  return {
    question: 'Should I take the job in Lisbon?',
    is_open_reflection: false,
    life_area: 'Work',
    deck: {
      name: deck.name,
      system: deck.system,
      tradition_notes: deck.tradition_notes,
      supports_reversals: deck.supports_reversals,
    },
    spread: { name: spread.name, description: spread.description },
    cards: slugs.map((slug, i) => {
      const c = deck.cards.find((x) => x.slug === slug)!;
      const reversed = i === 1 && deck.supports_reversals;
      return {
        position_index: i,
        position_name: spread.positions[i]!.name,
        position_prompt: spread.positions[i]!.prompt,
        card_id: `00000000-0000-4000-8000-00000000000${i}`,
        name: c.name,
        title: c.title,
        arcana: c.arcana,
        suit_label: c.suit_label,
        rank_label: c.rank_label,
        numeral: c.numeral,
        number: c.number,
        element: c.element,
        astrology: c.astrology,
        correspondences: c.correspondences,
        orientation: reversed ? 'reversed' : 'upright',
        keywords: reversed && c.keywords_reversed.length ? c.keywords_reversed : c.keywords_upright,
        meaning: reversed && c.meaning_reversed ? c.meaning_reversed : c.meaning_upright,
        reversed_without_text: reversed && !c.meaning_reversed,
      };
    }),
    user_notes: 'The Tower again. I keep drawing it when I think about money.',
    depth: selectDepth({ ai_explanation_depth: 'standard', experience_level: null }),
    safety: NO_FLAG,
    forbidden_terms_sample: deck.system === 'thoth' ? ['pentacles', 'page'] : ['disks', 'prince'],
    ...over,
  };
}

describe('interpret_reading prompt (AI_LAYER prompt rules 1–8)', () => {
  it('names the deck system, forbids substitution, grounds in supplied reference text', () => {
    const thoth = input(THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']);
    const sys = systemPrompt(thoth);
    expect(sys).toMatch(/Thoth deck/);
    expect(sys).toMatch(/Never use Rider–Waite–Smith names/);
    expect(sys).toMatch(/Do not rely on your own recollection/);
    expect(sys).toMatch(/suggests/);
    const rws = systemPrompt(input(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']));
    expect(rws).toMatch(/Rider–Waite–Smith deck/);
    expect(rws).toMatch(/Never use Thoth names/);
  });

  it('the user turn carries the question, every position prompt, each card’s reference row and the note verbatim', () => {
    const rws = input(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const u = userPrompt(rws);
    expect(u).toContain('“Should I take the job in Lisbon?”');
    for (const c of rws.cards) {
      expect(u).toContain(
        `Position ${c.position_index + 1} of ${rws.cards.length} (position_index ${c.position_index}) — ${c.position_name}: ${c.position_prompt}`,
      );
      expect(u).toContain(`Card: ${c.name}`);
      expect(u).toContain(c.meaning.slice(0, 60));
      expect(u).toContain(c.keywords[0]!);
    }
    expect(u).toContain('The Tower (reversed)');
    expect(u).toContain('“The Tower again. I keep drawing it when I think about money.”');
    // The other deck's terms appear only in the explicit "do not use" line.
    expect(u.replace(/Do not use these terms[^\n]*/, '')).not.toMatch(/disks|prince/i);
  });

  it('open reflection framing replaces the question; a Thoth reversed card is explained as dignity', () => {
    const open = userPrompt(
      input(RWS_DECK, ['strength'], { question: null, is_open_reflection: true }),
    );
    expect(open).toMatch(/open reflection/);
    expect(open).not.toContain('Question');
    const thoth = input(THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']);
    expect(userPrompt(thoth)).not.toContain('reversed');
  });

  it('depth and experience change the length guidance; safety adds the no-advice clause', () => {
    const brief = systemPrompt(
      input(RWS_DECK, ['strength'], {
        depth: selectDepth({ ai_explanation_depth: 'brief', experience_level: null }),
      }),
    );
    const exp = systemPrompt(
      input(RWS_DECK, ['strength'], {
        depth: selectDepth({ ai_explanation_depth: 'deep', experience_level: 'experienced' }),
      }),
    );
    expect(brief).toContain('one or two sentences');
    expect(exp).toContain('The reader is experienced');
    const flagged = systemPrompt(
      input(RWS_DECK, ['strength'], { safety: { category: 'medical', severity: 'medium' } }),
    );
    expect(flagged).toMatch(/high-stakes topic \(medical\)/);
    expect(flagged).toMatch(/Do not give medical, legal or financial advice/);
    expect(flagged).toMatch(/Keep the reflection/);
  });

  it('the request carries the schema, the deep tier by task, the user id and only IDs as refs', () => {
    const rws = input(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const req = buildInterpretRequest(rws, { userId: 'u1', readingId: 'r1', bannedTerms: [] });
    expect(req.task).toBe('interpret_reading');
    expect(req.schema).toBe(modelInterpretationSchema);
    expect(req.maxTokens).toBe(rws.depth.maxTokens);
    expect(req.objectRefs).toEqual([{ type: 'reading', id: 'r1' }]);
    expect(JSON.stringify(req.objectRefs)).not.toContain('Lisbon');
  });
});

describe('interpret_reading validator', () => {
  const rws = input(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
  const thoth = input(THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']);
  const good = (i: InterpretReadingInput) =>
    modelInterpretationSchema.parse(
      mockInterpretation({
        ...buildInterpretRequest(i, { userId: 'u', readingId: 'r', bannedTerms: [] }),
        messages: [],
      }),
    );

  it('accepts the mock fixture for both decks (schema, coverage, purity, register)', () => {
    expect(validateInterpretation(good(rws), rws, bannedTerms(rwsV, thothV))).toEqual([]);
    expect(validateInterpretation(good(thoth), thoth, bannedTerms(thothV, rwsV))).toEqual([]);
  });

  it('flags a Thoth output that says Pentacles or Page, by term', () => {
    const v = good(thoth);
    v.per_card[0]!.text =
      'The Page of Pentacles suggests a student’s patience in this position, one way to read it.';
    const issues = validateInterpretation(v, thoth, bannedTerms(thothV, rwsV));
    expect(issues).toEqual(expect.arrayContaining(['deck_purity:pentacles', 'deck_purity:page']));
  });

  it('flags missing or duplicated positions and a predictive register', () => {
    const v = good(rws);
    v.per_card = v.per_card.slice(0, 2);
    expect(validateInterpretation(v, rws, [])).toContain('position_coverage');
    const w = good(rws);
    w.combined = 'You will get the job; it is 90% certain.';
    expect(validateInterpretation(w, rws, [])).toEqual(
      expect.arrayContaining(['register:percentage', 'register:you will']),
    );
  });

  it('resolves card ids from the reading, in position order', () => {
    const v = good(rws);
    v.per_card.reverse();
    const out = resolveCardIds(v, rws);
    expect(out.per_card.map((c) => c.position_index)).toEqual([0, 1, 2]);
    expect(out.per_card.map((c) => c.card_id)).toEqual(rws.cards.map((c) => c.card_id));
    expect(findRegisterViolations(allText(v))).toEqual([]);
  });
});

describe('classify_safety', () => {
  it('builds a fast, tiny request over the question alone', () => {
    const req = buildSafetyRequest('Should I quit?', { userId: 'u', readingId: 'r' });
    expect(req.task).toBe('classify_safety');
    expect(req.maxTokens).toBeLessThanOrEqual(128);
    expect(req.messages[0]!.content).toContain('Should I quit?');
    expect(req.objectRefs).toEqual([{ type: 'reading', id: 'r' }]);
  });

  it('the mock classifier flags self-harm and leaves ordinary sadness alone', () => {
    const at = (q: string) =>
      mockSafety({ task: 'classify_safety', system: '', messages: [], mockInput: { question: q } });
    expect(at('Some days I want to end my life. Will it get better?')).toEqual({
      category: 'self_harm',
      severity: 'high',
    });
    expect(at('I am so sad about the breakup, will I heal?')).toEqual({
      category: 'none',
      severity: 'low',
    });
    expect(at('Should I put all my savings into crypto?')).toEqual({
      category: 'financial',
      severity: 'medium',
    });
  });
});
