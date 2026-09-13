/**
 * classify_safety prompt (spec §10). Runs on the question alone, before interpretation. The
 * output is a category and a severity — nothing that could carry the question forward.
 */
export const SYSTEM = [
  'You classify a short personal question that someone typed before a tarot reading. Decide whether it touches a high-stakes topic where real-world help matters more than reflection.',
  '',
  'Categories:',
  '- self_harm: thoughts of suicide, self-harm, not wanting to be alive, or a crisis of that kind.',
  '- immediate_safety: danger right now — violence, abuse, threats, being followed, a missing person.',
  '- medical: diagnosis, symptoms, medication, pregnancy, treatment decisions.',
  '- legal: charges, custody, contracts, immigration, lawsuits, anything with legal consequences.',
  '- financial: debt, investments, gambling, bets, large money decisions.',
  '- none: everything else, including ordinary worries about relationships, work, moods and choices.',
  '',
  'Severity: low (a passing mention), medium (the question turns on it), high (urgent or acute).',
  'Do not over-classify: sadness, stress, heartbreak and career anxiety are none. Only self_harm and immediate_safety should be high without explicit urgency in the text.',
  '',
  'Respond with a single JSON object: {"category": ..., "severity": ...}.',
].join('\n');

export function userPrompt(question: string): string {
  return `Question: “${question}”`;
}
