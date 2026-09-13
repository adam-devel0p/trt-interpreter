/** Failure copy (DESIGN_SYSTEM: what happened · what is safe · what to do next). */
export const FAILURE_COPY: Record<string, string> = {
  invalid_output:
    'The interpretation came back in a shape the app could not use. Your reading is saved; you can try again.',
  timeout:
    'The interpretation took too long and was stopped. Your reading is saved; try again in a moment.',
  provider_error:
    'The interpretation service is not responding right now. Your reading is saved; try again later.',
  circuit_open:
    'The interpretation service has been failing, so the app is pausing calls for a minute. Your reading is saved.',
  budget_denied:
    'You have reached the interpretation limit for now. Your reading and notes are saved and stay readable; the reference meanings below are always available.',
  refusal:
    'The model declined to interpret this reading. Your reading is saved; the reference meanings below are still here.',
  deck_purity:
    'The generated text mixed in vocabulary from another deck, so it was not saved. Your reading is complete; the deck-native reference meanings are below.',
  cancelled: 'Stopped. What arrived so far is kept; you can generate again whenever you like.',
  consent: 'AI interpretation is off for your account. Turn it on in Profile if you want one.',
  unavailable:
    'Interpretation is unavailable. Your reading is saved and complete; try again later.',
};

export function failureMessage(errorClass: string): string {
  return FAILURE_COPY[errorClass] ?? FAILURE_COPY.unavailable!;
}
