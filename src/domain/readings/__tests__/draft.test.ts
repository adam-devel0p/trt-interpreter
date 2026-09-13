import { describe, expect, it } from 'vitest';
import type { DrawRecord } from '../draw';
import {
  advance,
  applyDraw,
  back,
  canAdvance,
  cardsComplete,
  FLOW_STEPS,
  goTo,
  hasCards,
  newDraft,
  nextEmptySlot,
  placeCard,
  reachable,
  removeCard,
  restoreDraft,
  setDeck,
  setLifeArea,
  setNotes,
  setOccurredAt,
  setOpenReflection,
  setQuestion,
  setSource,
  setSpread,
  swapCards,
  toCreateInput,
  toggleOrientation,
  type ReadingDraft,
} from '../draft';

const RWS = { id: '00000000-0000-4000-8000-00000000000a', supports_reversals: true };
const THOTH = { id: '00000000-0000-4000-8000-00000000000b', supports_reversals: false };
const THREE = { id: '00000000-0000-4000-8000-000000000003', card_count: 3 };
const ONE = { id: '00000000-0000-4000-8000-000000000001', card_count: 1 };
const card = (n: number) => `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`;
const rng: DrawRecord = {
  algorithm: 'fisher-yates/xoshiro128**',
  seed: 'a'.repeat(32),
  drawn_at: '2026-09-12T10:00:00.000Z',
  deck_id: RWS.id,
  deck_size: 78,
  reversal_probability: 0.5,
};

const start = () => newDraft({ deck: RWS, source: 'physical', useReversals: true });

/** A complete physical three-card RWS draft with one reversal, sitting on the notes step. */
function complete(): ReadingDraft {
  let d = start();
  d = setQuestion(d, 'Should I take the job?');
  d = advance(d); // life_area
  d = advance(d); // spread
  d = setSpread(d, THREE);
  d = advance(d); // deck
  d = advance(d); // source
  d = advance(d); // cards
  d = placeCard(d, 0, card(1));
  d = placeCard(d, 1, card(2));
  d = placeCard(d, 2, card(3));
  d = toggleOrientation(d, 1);
  d = advance(d); // notes
  return d;
}

describe('reading draft machine', () => {
  it('starts at the question with profile defaults applied', () => {
    const d = start();
    expect(d.step).toBe('question');
    expect(d.deck_id).toBe(RWS.id);
    expect(d.source).toBe('physical');
    expect(d.uses_reversals).toBe(true);
    expect(d.cards).toEqual([]);
    expect(newDraft({ deck: THOTH, source: 'digital', useReversals: true }).uses_reversals).toBe(
      false,
    );
    expect(newDraft({ deck: RWS, source: 'digital', useReversals: false }).uses_reversals).toBe(
      false,
    );
    expect(newDraft({ deck: null, source: 'digital', useReversals: true }).deck_id).toBeNull();
  });

  it('the step order is exactly §6.2', () => {
    expect(FLOW_STEPS).toEqual([
      'question',
      'life_area',
      'spread',
      'deck',
      'source',
      'cards',
      'notes',
    ]);
  });

  it('question or open reflection gates the first step; life area is never required', () => {
    const d = start();
    expect(canAdvance(d)).toBe(false);
    expect(advance(d)).toBe(d);
    expect(canAdvance(setQuestion(d, '   '))).toBe(false);
    expect(canAdvance(setQuestion(d, 'What now?'))).toBe(true);
    const open = setOpenReflection(setQuestion(d, 'typed then cleared'));
    expect(open.question).toBe('');
    expect(canAdvance(open)).toBe(true);
    const onLifeArea = advance(open);
    expect(onLifeArea.step).toBe('life_area');
    expect(canAdvance(onLifeArea)).toBe(true); // nothing chosen, still skippable
    expect(setLifeArea(onLifeArea, 'work').life_area).toBe('work');
    expect(setLifeArea(onLifeArea, null).life_area).toBeNull();
  });

  it('typing a question after choosing open reflection switches back', () => {
    const d = setQuestion(setOpenReflection(start()), 'Actually, this');
    expect(d.is_open_reflection).toBe(false);
    expect(d.question).toBe('Actually, this');
  });

  it('a step that cannot be completed is never reachable', () => {
    const d = setQuestion(start(), 'q');
    expect(reachable(d, 'life_area')).toBe(true);
    expect(reachable(d, 'spread')).toBe(true);
    expect(reachable(d, 'deck')).toBe(false); // no spread yet
    expect(goTo(d, 'deck')).toBe(d);
    const withSpread = setSpread(d, THREE);
    expect(reachable(withSpread, 'cards')).toBe(true);
    expect(reachable(withSpread, 'notes')).toBe(false); // cards empty
    expect(goTo(withSpread, 'cards').step).toBe('cards');
  });

  it('choosing a spread sizes the slots; physical cards survive a resize', () => {
    let d = setSpread(start(), THREE);
    expect(d.cards).toEqual([null, null, null]);
    d = placeCard(d, 0, card(1));
    d = placeCard(d, 1, card(2));
    d = setSpread(d, ONE);
    expect(d.cards).toEqual([{ card_id: card(1), orientation: 'upright' }]);
    d = setSpread(d, THREE);
    expect(d.cards).toEqual([{ card_id: card(1), orientation: 'upright' }, null, null]);
    expect(setSpread(d, THREE)).toBe(d); // no-op keeps the reference
  });

  it('a digital draw is discarded when the spread, deck or source changes', () => {
    let d = newDraft({ deck: RWS, source: 'digital', useReversals: true });
    d = setSpread(d, THREE);
    d = applyDraw(
      d,
      [
        { position_index: 0, card_id: card(1), orientation: 'upright' },
        { position_index: 1, card_id: card(2), orientation: 'reversed' },
        { position_index: 2, card_id: card(3), orientation: 'upright' },
      ],
      rng,
    );
    expect(cardsComplete(d)).toBe(true);
    expect(d.rng).toEqual(rng);
    expect(setSpread(d, ONE).cards).toEqual([null]);
    expect(setSpread(d, ONE).rng).toBeNull();
    expect(setDeck(d, THOTH, true).cards).toEqual([null, null, null]);
    expect(setSource(d, 'physical').rng).toBeNull();
    expect(setSource(d, 'physical').cards).toEqual([null, null, null]);
    // A draw of the wrong size or on a physical draft is ignored.
    const physical = setSource(d, 'physical');
    expect(applyDraw(physical, [], rng)).toBe(physical);
  });

  it('cards are deck-scoped: switching deck clears them and re-derives reversals', () => {
    let d = setSpread(start(), THREE);
    d = placeCard(d, 0, card(1));
    d = toggleOrientation(d, 0);
    const thoth = setDeck(d, THOTH, true);
    expect(thoth.deck_id).toBe(THOTH.id);
    expect(thoth.cards).toEqual([null, null, null]);
    expect(thoth.uses_reversals).toBe(false);
    // Same deck, reversals turned off in the profile: cards stay, orientations flatten.
    const flat = setDeck(d, RWS, false);
    expect(flat.cards[0]).toEqual({ card_id: card(1), orientation: 'upright' });
    expect(flat.uses_reversals).toBe(false);
    expect(toggleOrientation(flat, 0)).toBe(flat); // cannot reverse
    expect(setDeck(d, RWS, true)).toBe(d); // no change
  });

  it('place / remove / toggle / swap and the next empty slot', () => {
    let d = setSpread(start(), THREE);
    expect(nextEmptySlot(d)).toBe(0);
    d = placeCard(d, 0, card(1));
    expect(hasCards(d)).toBe(true);
    expect(nextEmptySlot(d)).toBe(1);
    expect(nextEmptySlot(d, 2)).toBe(2);
    expect(placeCard(d, 1, card(1))).toBe(d); // a card sits in one slot only
    d = placeCard(d, 2, card(3));
    expect(nextEmptySlot(d, 2)).toBe(1); // wraps
    d = toggleOrientation(d, 2);
    expect(d.cards[2]?.orientation).toBe('reversed');
    d = swapCards(d, 0, 2);
    expect(d.cards[0]).toEqual({ card_id: card(3), orientation: 'reversed' });
    expect(d.cards[2]).toEqual({ card_id: card(1), orientation: 'upright' });
    expect(swapCards(d, 0, 0)).toBe(d);
    expect(swapCards(d, 0, 9)).toBe(d);
    expect(placeCard(d, 9, card(4))).toBe(d);
    d = removeCard(d, 0);
    expect(d.cards[0]).toBeNull();
    expect(removeCard(d, 0)).toBe(d);
    expect(nextEmptySlot(d)).toBe(0);
  });

  it('back never loses entered cards, and the flow reaches save in the expected number of actions', () => {
    const d = complete();
    expect(d.step).toBe('notes');
    const b = back(back(d));
    expect(b.step).toBe('source');
    expect(b.cards).toEqual(d.cards);
    expect(goTo(b, 'notes').cards).toEqual(d.cards);
    const first = start();
    expect(back(first)).toBe(first); // never before the first step
  });

  it('produces a valid create input, with digital/physical rng rules and reversal rules enforced', () => {
    const d = setOccurredAt(
      setNotes(complete(), '  I notice the Tower again. '),
      '2026-09-10T08:00:00.000Z',
    );
    const input = toCreateInput(d);
    expect(input).toEqual({
      question: 'Should I take the job?',
      is_open_reflection: false,
      life_area: null,
      spread_id: THREE.id,
      deck_id: RWS.id,
      source: 'physical',
      uses_reversals: true,
      cards: [
        { position_index: 0, card_id: card(1), orientation: 'upright' },
        { position_index: 1, card_id: card(2), orientation: 'reversed' },
        { position_index: 2, card_id: card(3), orientation: 'upright' },
      ],
      user_notes: 'I notice the Tower again.',
      occurred_at: '2026-09-10T08:00:00.000Z',
      rng: null,
    });
    expect(() => toCreateInput(setSpread(start(), THREE))).toThrow(/incomplete/);
    // A physical draft with an rng record, or a reversed card without reversals, is rejected.
    expect(() => toCreateInput({ ...d, rng })).toThrow();
    expect(() => toCreateInput({ ...d, uses_reversals: false })).toThrow();
    expect(() => toCreateInput({ ...d, question: '', is_open_reflection: false })).toThrow();
  });

  it('restores a persisted draft and discards anything malformed', () => {
    const d = complete();
    expect(restoreDraft(JSON.stringify(d))).toEqual(d);
    expect(restoreDraft(d)).toEqual(d);
    expect(restoreDraft('{not json')).toBeNull();
    expect(restoreDraft({ ...d, version: 99 })).toBeNull();
    expect(restoreDraft({ ...d, step: 'summon' })).toBeNull();
    expect(restoreDraft({ ...d, cards: [{ card_id: 'nope', orientation: 'upright' }] })).toBeNull();
    expect(restoreDraft({ ...d, extra: 1 })).toBeNull();
  });
});
