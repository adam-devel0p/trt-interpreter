import { expectTypeOf, test } from 'vitest';
import type { AnalyticsEventName, AnalyticsProps } from '../events';

/**
 * Type-level half of FR-28: the props of every event are closed objects with no string
 * member, so `track(user, 'reading_completed', { question })` does not compile.
 */
test('no analytics event accepts a free-text property', () => {
  type AnyProps = AnalyticsProps<AnalyticsEventName>;
  type StringKeys = {
    [K in keyof AnyProps]-?: AnyProps[K] extends string | null
      ? string extends AnyProps[K]
        ? K
        : never
      : never;
  }[keyof AnyProps];
  expectTypeOf<StringKeys>().toEqualTypeOf<never>();

  // Excess properties are compile errors on the typed tracker signature.
  type Track = <N extends AnalyticsEventName>(name: N, props: AnalyticsProps<N>) => void;
  const track: Track = () => {};
  track('reading_completed', {
    source: 'digital',
    deck: 'rws',
    cards: 3,
    has_question: true,
    first: true,
  });
  track('reading_completed', {
    source: 'digital',
    deck: 'rws',
    cards: 3,
    has_question: true,
    first: true,
    // @ts-expect-error a question is journal content and has no place in analytics
    question: 'x',
  });
  // @ts-expect-error nor a note
  track('reading_reopened', { age: 'week', user_notes: 'private' });
  // @ts-expect-error nor an unknown event
  track('note_written', {});
});
