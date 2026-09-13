/**
 * The write gate behind invariant 7 / spec §9.2 (docs/AI_LAYER.md#write-gate).
 *
 * Anything a model produced goes through `modelWrite()`, which refuses every payload whose
 * `fact_status` is outside `MODEL_ALLOWED`. `CONFIRMED_FACT` and `USER_REFLECTION` are reachable
 * only through `userWrite()`, called from handlers that carry a real user action. Where a table
 * fixes the column (`interpretations.fact_status`) a database check constraint backs this up, so
 * the invariant holds even for code that never imports this module.
 */

export const FACT_STATUSES = [
  'CONFIRMED_FACT',
  'INFERRED_EVENT',
  'USER_REFLECTION',
  'TAROT_INTERPRETATION',
  'POSSIBILITY',
  'SYSTEM_CORRELATION',
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const MODEL_ALLOWED: readonly FactStatus[] = [
  'INFERRED_EVENT',
  'TAROT_INTERPRETATION',
  'POSSIBILITY',
  'SYSTEM_CORRELATION',
];

export const USER_ONLY: readonly FactStatus[] = ['CONFIRMED_FACT', 'USER_REFLECTION'];

export class WriteGateError extends Error {
  override readonly name = 'WriteGateError';
  constructor(
    readonly origin: 'model' | 'user',
    readonly factStatus: string,
  ) {
    super(`${origin} writes may not carry fact_status ${factStatus}`);
  }
}

export interface Gated<T> {
  fact_status: FactStatus;
  payload: T;
}

type ModelFactStatus = Exclude<FactStatus, 'CONFIRMED_FACT' | 'USER_REFLECTION'>;

/**
 * Wrap model-derived content for persistence. Throws for any status a model may not produce.
 * The status is checked at runtime against the list, not only at the type level, so a caller
 * that casts cannot get past it.
 */
export function modelWrite<T>(factStatus: ModelFactStatus | FactStatus, payload: T): Gated<T> {
  if (!MODEL_ALLOWED.includes(factStatus)) throw new WriteGateError('model', factStatus);
  return { fact_status: factStatus, payload };
}

/** Wrap content that came from a user action. Any status is permitted, including CONFIRMED_FACT. */
export function userWrite<T>(factStatus: FactStatus, payload: T): Gated<T> {
  if (!FACT_STATUSES.includes(factStatus)) throw new WriteGateError('user', factStatus);
  return { fact_status: factStatus, payload };
}
