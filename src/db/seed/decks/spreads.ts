import { spreadSeedSchema, type SpreadSeed } from '@/domain/decks/types';

/**
 * Five built-in spreads (phase 02 §6). Each position carries a `prompt` that later grounds
 * per-position interpretation (§6.2). Layout coordinates are relative (see spreadLayoutSchema):
 * card aspect is 3:5, so a slot of width `w` on a canvas of aspect `a` is `w·a/0.6` tall.
 */
export const SPREADS: SpreadSeed[] = [
  {
    slug: 'one-card',
    name: 'One card',
    description: 'A single card for a single question, or for the day. The fastest way to start.',
    positions: [
      {
        index: 0,
        key: 'the_card',
        name: 'The card',
        prompt:
          'Read this card as the whole response: what it suggests about the question as asked, and one way the person might carry it through the day.',
      },
    ],
    layout: { aspect: 1.2, slots: [{ index: 0, x: 0.5, y: 0.5, w: 0.4 }] },
    deck_scope: null,
    sort_order: 0,
  },
  {
    slug: 'three-card',
    name: 'Past · Present · Future',
    description:
      'Three cards along a line of time. Good for seeing how a situation has been moving.',
    positions: [
      {
        index: 0,
        key: 'past',
        name: 'Past',
        prompt:
          'What has been shaping this situation up to now — an influence, a decision or a mood that is still felt.',
      },
      {
        index: 1,
        key: 'present',
        name: 'Present',
        prompt:
          'Where things stand at this moment; what is most active or most pressing right now.',
      },
      {
        index: 2,
        key: 'future',
        name: 'Future',
        prompt:
          'One way things may develop if the present continues — a direction, never a certainty.',
      },
    ],
    layout: {
      aspect: 2.1,
      slots: [
        { index: 0, x: 0.18, y: 0.5, w: 0.26 },
        { index: 1, x: 0.5, y: 0.5, w: 0.26 },
        { index: 2, x: 0.82, y: 0.5, w: 0.26 },
      ],
    },
    deck_scope: null,
    sort_order: 1,
  },
  {
    slug: 'situation-advice-outcome',
    name: 'Situation · Advice · Outcome',
    description: 'Three cards that move from what is happening to what might help.',
    positions: [
      {
        index: 0,
        key: 'situation',
        name: 'Situation',
        prompt: 'The heart of what is going on, including what the person may not have named yet.',
      },
      {
        index: 1,
        key: 'advice',
        name: 'Advice',
        prompt:
          'An attitude or action the card suggests trying — framed as one option to consider, not an instruction.',
      },
      {
        index: 2,
        key: 'outcome',
        name: 'Likely outcome',
        prompt:
          'How things may tend to go if the advice is taken; a possibility to watch for, not a prediction.',
      },
    ],
    layout: {
      aspect: 2.1,
      slots: [
        { index: 0, x: 0.18, y: 0.5, w: 0.26 },
        { index: 1, x: 0.5, y: 0.5, w: 0.26 },
        { index: 2, x: 0.82, y: 0.5, w: 0.26 },
      ],
    },
    deck_scope: null,
    sort_order: 2,
  },
  {
    slug: 'decision',
    name: 'Decision',
    description:
      'Two paths side by side, with you in the middle. For when there are two real options.',
    positions: [
      {
        index: 0,
        key: 'you',
        name: 'Where you stand',
        prompt:
          'The person’s own position in the decision: what they bring to it and what is pulling on them.',
      },
      {
        index: 1,
        key: 'a_opens',
        name: 'Path A — what it opens',
        prompt: 'What the first option tends to make possible or bring closer.',
      },
      {
        index: 2,
        key: 'a_asks',
        name: 'Path A — what it asks',
        prompt: 'What the first option is likely to cost or require.',
      },
      {
        index: 3,
        key: 'b_opens',
        name: 'Path B — what it opens',
        prompt: 'What the second option tends to make possible or bring closer.',
      },
      {
        index: 4,
        key: 'b_asks',
        name: 'Path B — what it asks',
        prompt: 'What the second option is likely to cost or require.',
      },
    ],
    layout: {
      aspect: 1.1,
      slots: [
        { index: 0, x: 0.5, y: 0.45, w: 0.2 },
        { index: 1, x: 0.18, y: 0.24, w: 0.2 },
        { index: 2, x: 0.18, y: 0.7, w: 0.2 },
        { index: 3, x: 0.82, y: 0.24, w: 0.2 },
        { index: 4, x: 0.82, y: 0.7, w: 0.2 },
      ],
    },
    deck_scope: null,
    sort_order: 3,
  },
  {
    slug: 'celtic-cross-lite',
    name: 'Celtic cross, short',
    description:
      'The centre of the traditional Celtic cross in five cards: enough structure without the sprawl.',
    positions: [
      {
        index: 0,
        key: 'heart',
        name: 'The heart of the matter',
        prompt: 'The central issue as it actually is, beneath how it is being described.',
      },
      {
        index: 1,
        key: 'crossing',
        name: 'What crosses it',
        prompt:
          'The obstacle, tension or complicating factor lying across the central issue — not necessarily negative.',
      },
      {
        index: 2,
        key: 'above',
        name: 'What you hold in mind',
        prompt:
          'The conscious aim, hope or worry the person brings; what they think this is about.',
      },
      {
        index: 3,
        key: 'beneath',
        name: 'What lies beneath',
        prompt: 'The root, history or unspoken assumption under the situation.',
      },
      {
        index: 4,
        key: 'ahead',
        name: 'What comes next',
        prompt:
          'The near development the cards suggest — a tendency to watch for, offered as possibility.',
      },
    ],
    layout: {
      aspect: 1.0,
      slots: [
        { index: 0, x: 0.38, y: 0.5, w: 0.18 },
        { index: 1, x: 0.38, y: 0.5, w: 0.18, rotate: 90 },
        { index: 2, x: 0.38, y: 0.17, w: 0.18 },
        { index: 3, x: 0.38, y: 0.83, w: 0.18 },
        { index: 4, x: 0.8, y: 0.5, w: 0.18 },
      ],
    },
    deck_scope: null,
    sort_order: 4,
  },
].map((s) => spreadSeedSchema.parse(s));
