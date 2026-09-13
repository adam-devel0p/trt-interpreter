/**
 * "Revisit this?" is offered only when a reading has a future-facing shape (FR-14, §6.2 step 23).
 * A pure heuristic over what the person wrote and which positions the spread has — never a model.
 */

const FUTURE_POSITION = /\b(future|outcome|ahead|next|opens|asks|will|result|unfold)\b/i;
const FUTURE_QUESTION =
  /\b(will|should|going to|next|future|when|can i|could i|what if|whether|outcome|happen)\b/i;

export function isFutureFacing(reading: {
  question: string | null;
  positions: readonly { key: string; name: string }[];
}): boolean {
  if (reading.question && FUTURE_QUESTION.test(reading.question)) return true;
  return reading.positions.some((p) => FUTURE_POSITION.test(`${p.key} ${p.name}`));
}
