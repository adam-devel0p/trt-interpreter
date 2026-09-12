/** Flag list from docs/IMPLEMENTATION_PLAN.md#3-cross-cutting-strategies. Default off in prod. */
export const FLAGS = [
  'ai_extraction',
  'entity_resolution',
  'journey_autocreate',
  'correlation_suggestions',
  'ask_my_history',
  'period_summaries',
  'share_cards',
  'physical_photo_ocr',
] as const;

export type FlagName = (typeof FLAGS)[number];

export function isFlagName(v: string): v is FlagName {
  return (FLAGS as readonly string[]).includes(v);
}

/** Env variable that carries a flag's default: `ai_extraction` → `FLAG_AI_EXTRACTION`. */
export function envKeyFor(flag: FlagName): `FLAG_${Uppercase<FlagName>}` {
  return `FLAG_${flag.toUpperCase() as Uppercase<FlagName>}`;
}
