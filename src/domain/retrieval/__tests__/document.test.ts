import { describe, expect, it } from 'vitest';
import {
  BUILDER_VERSION,
  buildRetrievalDocument,
  DOCUMENT_MAX_CHARS,
  type DocumentInput,
} from '../document';

/**
 * Retrieval documents (§8.3): deterministic, compact, deck-native, never the notes. The
 * snapshots pin the template; a change to it is a builder-version bump.
 */
const reading: DocumentInput = {
  objectType: 'reading',
  journeys: ['The agency and ambition'],
  text: 'Should I take the offer from the agency?',
  lifeArea: 'Work',
  themes: ['Decision', 'Ambition', 'Uncertainty'],
  deck: 'Thoth',
  cards: [
    { name: 'Lust' },
    { name: 'Adjustment' },
    { name: 'Prince of Disks', orientation: 'reversed' },
  ],
  entities: ['the agency', 'Sam'],
  possibilities: ['Choosing to take the offer may open something.'],
  timeframe: 'next month',
  outcome: 'happened — Took it. The paperwork held.',
  linked: ['event 2026-04-29 I accepted the offer from the agency today.'],
};

describe('buildRetrievalDocument', () => {
  it('renders a reading with every segment in template order, deck-native card names', () => {
    const doc = buildRetrievalDocument(reading);
    expect(doc.text).toMatchInlineSnapshot(
      `"The agency and ambition. Should I take the offer from the agency. Life area: Work. Themes: Decision, Ambition, Uncertainty. Cards (Thoth): Lust, Adjustment, Prince of Disks (reversed). Entities: the agency, Sam. Possibility: Choosing to take the offer may open something. Timeframe: next month. Outcome: happened — Took it. The paperwork held. Linked: event 2026-04-29 I accepted the offer from the agency today."`,
    );
    expect(doc.builderVersion).toBe(BUILDER_VERSION);
    expect(doc.text).not.toContain('Strength');
  });

  it('renders a life event with its type and no cards', () => {
    const doc = buildRetrievalDocument({
      objectType: 'life_event',
      journeys: ['Me and Maya'],
      text: 'Maya and I had the conversation about the distance.',
      lifeArea: 'Relationships',
      eventType: 'Relationship',
      themes: ['Distance', 'Communication'],
      entities: ['Maya'],
    });
    expect(doc.text).toMatchInlineSnapshot(
      `"Me and Maya. Maya and I had the conversation about the distance. Event: Relationship. Life area: Relationships. Themes: Distance, Communication. Entities: Maya."`,
    );
  });

  it('names an open reflection and stays minimal without derived data', () => {
    const doc = buildRetrievalDocument({
      objectType: 'reading',
      journeys: [],
      text: null,
      lifeArea: null,
      themes: [],
      entities: [],
    });
    expect(doc.text).toBe('Open reflection, no question.');
  });

  it('is deterministic: same input, same text and hash; a changed input changes the hash', () => {
    const a = buildRetrievalDocument(reading);
    const b = buildRetrievalDocument({ ...reading, cards: [...reading.cards!] });
    expect(b).toEqual(a);
    const c = buildRetrievalDocument({ ...reading, outcome: 'did not happen' });
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  it('caps lists and the total length by dropping whole trailing segments, never the words', () => {
    const doc = buildRetrievalDocument({
      ...reading,
      text: 'x'.repeat(400),
      themes: Array.from({ length: 20 }, (_, i) => `Theme ${i}`),
      cards: Array.from({ length: 20 }, (_, i) => ({ name: `Card ${i}` })),
      entities: Array.from({ length: 20 }, (_, i) => `Person ${i}`),
      possibilities: Array.from({ length: 5 }, (_, i) => 'p'.repeat(150) + i),
      linked: Array.from({ length: 5 }, (_, i) => 'l'.repeat(150) + i),
    });
    expect(doc.text.length).toBeLessThanOrEqual(DOCUMENT_MAX_CHARS);
    expect(doc.text.startsWith('The agency and ambition. xxx')).toBe(true);
    expect((doc.text.match(/Theme \d+/g) ?? []).length).toBeLessThanOrEqual(6);
    expect(doc.text).not.toContain('Linked:');
    // Segments are whole: the text never ends inside "Themes: …, " mid-list.
    expect(doc.text.endsWith('.')).toBe(true);
  });

  it('never contains anything it was not given (no notes field exists)', () => {
    const doc = buildRetrievalDocument({ ...reading, text: 'A question', themes: [] });
    expect(doc.text).not.toMatch(/note/i);
    expect(Object.keys(reading)).not.toContain('notes');
  });
});
