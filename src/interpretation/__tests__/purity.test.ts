import { describe, expect, it } from 'vitest';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import {
  bannedTerms,
  checkDeckPurity,
  deckVocabulary,
  findPurityViolations,
} from '@/domain/decks/purity';

const rws = deckVocabulary(RWS_DECK);
const thoth = deckVocabulary(THOTH_DECK);
const bannedInThoth = bannedTerms(thoth, rws);
const bannedInRws = bannedTerms(rws, thoth);

describe('deck purity (spec §6.7, §19)', () => {
  const lower = (l: { term: string }[]) => l.map((t) => t.term.toLowerCase());

  it('bans the other deck’s court terms, suit and renamed trumps', () => {
    expect(lower(bannedInThoth)).toEqual(
      expect.arrayContaining([
        'page',
        'pentacles',
        'justice',
        'temperance',
        'judgement',
        'the world',
        'the magician',
        'the high priestess',
        'wheel of fortune',
        'rider–waite–smith',
      ]),
    );
    expect(lower(bannedInRws)).toEqual(
      expect.arrayContaining([
        'prince',
        'princess',
        'disks',
        'lust',
        'adjustment',
        'art',
        'the aeon',
        'the universe',
        'the magus',
        'thoth',
      ]),
    );
  });

  it('never bans a term the deck itself uses, nor the other deck’s ordinary-word titles', () => {
    // Knight and Queen exist in both courts; Strength is the Thoth Nine of Wands' title.
    expect(lower(bannedInThoth)).not.toContain('knight');
    expect(lower(bannedInThoth)).not.toContain('queen');
    expect(lower(bannedInThoth)).not.toContain('strength');
    expect(lower(bannedInThoth)).not.toContain('the fool');
    expect(lower(bannedInRws)).not.toContain('knight');
    expect(lower(bannedInRws)).not.toContain('the tower');
    // Thoth small-card titles are everyday words; an RWS reading may say "change" or "success".
    expect(lower(bannedInRws)).not.toContain('change');
    expect(lower(bannedInRws)).not.toContain('success');
    expect(findPurityViolations('a season of change and modest success', bannedInRws)).toEqual([]);
  });

  it('single-word trump names are card references only when capitalised', () => {
    expect(
      findPurityViolations('a sense of justice and the art of waiting', bannedInThoth),
    ).toEqual([]);
    expect(
      findPurityViolations('Justice here suggests…', bannedInThoth).map((h) => h.term),
    ).toEqual(['justice']);
    expect(
      findPurityViolations('Art in this position suggests…', bannedInRws).map((h) => h.term),
    ).toEqual(['art']);
    // Suit and court words are card vocabulary whatever the case.
    expect(findPurityViolations('the pentacles suit', bannedInThoth).map((h) => h.term)).toEqual([
      'pentacles',
    ]);
  });

  it('a Thoth interpretation mentioning Pentacles or a Page fails', () => {
    const text = 'The Page of Pentacles here suggests a student’s patience, one way to read this.';
    const hits = findPurityViolations(text, bannedInThoth).map((h) => h.term);
    expect(hits).toContain('pentacles');
    expect(hits).toContain('page');
  });

  it('a Thoth interpretation in its own vocabulary passes', () => {
    const text =
      'Lust in the Situation position suggests appetite for the work itself; the Princess of Disks may point to a first practical step, and the Knight of Wands to how quickly you move. Strength (the Nine of Wands) is not drawn here.';
    expect(findPurityViolations(text, bannedInThoth)).toEqual([]);
  });

  it('an RWS interpretation mentioning Disks or a Prince fails; RWS vocabulary passes', () => {
    expect(
      checkDeckPurity('The Prince of Disks suggests…', RWS_DECK, THOTH_DECK).map((h) => h.term),
    ).toEqual(expect.arrayContaining(['prince', 'disks']));
    expect(
      checkDeckPurity(
        'The Page of Pentacles reversed may point to a lesson deferred; Strength suggests patience.',
        RWS_DECK,
        THOTH_DECK,
      ),
    ).toEqual([]);
  });

  it('matches whole words only, case-insensitively', () => {
    expect(findPurityViolations('a pageant of feelings', ['page'])).toEqual([]);
    expect(findPurityViolations('PENTACLES, again', ['pentacles'])).toEqual([
      { term: 'pentacles', count: 1 },
    ]);
    expect(findPurityViolations('the Rider-Waite-Smith deck', ['rider–waite–smith'])).toHaveLength(
      1,
    );
  });
});
