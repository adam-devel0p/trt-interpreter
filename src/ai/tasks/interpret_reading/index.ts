/**
 * interpret_reading task (docs/AI_LAYER.md#task-catalogue): builds the request for the runner
 * and validates what comes back beyond the schema — every position covered exactly once, no
 * vocabulary from the other deck system, hedged register. The caller supplies the banned-term
 * list (derived from the seed modules, which src/ai/ may not import).
 */
import { findPurityViolations, type BannedTerm } from '@/domain/decks/purity';
import { findRegisterViolations } from '@/domain/interpretation/register';
import type { StreamObjectRequest } from '../../run';
import type { ObjectRef } from '../../types';
import { systemPrompt, userPrompt, type InterpretReadingInput } from './prompt';
import {
  modelInterpretationSchema,
  type InterpretationOutput,
  type ModelInterpretation,
} from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { InterpretCardInput, InterpretReadingInput } from './prompt';

export interface InterpretOptions {
  userId: string;
  readingId: string;
  /** Terms from the other deck system; see domain/decks/purity. */
  bannedTerms: readonly BannedTerm[];
  objectRefs?: ObjectRef[];
}

export function allText(v: ModelInterpretation): string {
  return [
    v.synthesis,
    ...v.per_card.flatMap((c) => [c.text, ...c.nuances]),
    v.combined,
    ...v.reflective_prompts,
  ].join('\n');
}

/** Content-free issue labels: validator name, and for purity the offending deck terms. */
export function validateInterpretation(
  v: ModelInterpretation,
  input: InterpretReadingInput,
  banned: readonly BannedTerm[],
): string[] {
  const issues: string[] = [];
  const expected = input.cards.map((c) => c.position_index).sort((a, b) => a - b);
  const got = v.per_card.map((c) => c.position_index).sort((a, b) => a - b);
  if (expected.length !== got.length || expected.some((p, i) => p !== got[i])) {
    issues.push('position_coverage');
  }
  const text = allText(v);
  for (const hit of findPurityViolations(text, banned)) issues.push(`deck_purity:${hit.term}`);
  for (const hit of findRegisterViolations(text)) issues.push(`register:${hit.pattern}`);
  return issues;
}

export function repairHint(issues: string[]): string {
  const parts: string[] = [];
  if (issues.includes('position_coverage')) {
    parts.push('Include exactly one per_card entry for every drawn position, in order.');
  }
  const purity = issues.filter((i) => i.startsWith('deck_purity:')).map((i) => i.slice(12));
  if (purity.length) {
    parts.push(
      `You used vocabulary from the wrong deck system (${purity.join(', ')}); use only this deck's own card names, suit and court terms.`,
    );
  }
  const register = issues.filter((i) => i.startsWith('register:'));
  if (register.length) {
    parts.push(
      'Keep a hedged, non-predictive register: no percentages, no certainty about the future, no "must".',
    );
  }
  return parts.join(' ');
}

/** Attach card ids from the reading; the model never sees or writes them. */
export function resolveCardIds(
  v: ModelInterpretation,
  input: InterpretReadingInput,
): InterpretationOutput {
  const byPosition = new Map(input.cards.map((c) => [c.position_index, c.card_id]));
  return {
    ...v,
    per_card: v.per_card
      .slice()
      .sort((a, b) => a.position_index - b.position_index)
      .map((c) => ({ ...c, card_id: byPosition.get(c.position_index)! })),
  };
}

export function buildInterpretRequest(
  input: InterpretReadingInput,
  opts: InterpretOptions,
): StreamObjectRequest<ModelInterpretation> {
  return {
    task: 'interpret_reading',
    system: systemPrompt(input),
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: modelInterpretationSchema,
    maxTokens: input.depth.maxTokens,
    userId: opts.userId,
    objectRefs: opts.objectRefs ?? [{ type: 'reading', id: opts.readingId }],
    validate: (v) => validateInterpretation(v, input, opts.bannedTerms),
    repairHint,
    mockInput: {
      deckSystem: input.deck.system,
      cards: input.cards.map((c) => ({
        position_index: c.position_index,
        position_name: c.position_name,
        name: c.name,
        keyword: c.keywords[0] ?? '',
      })),
      question: input.is_open_reflection ? null : input.question,
      hasNote: Boolean(input.user_notes),
    },
  };
}
