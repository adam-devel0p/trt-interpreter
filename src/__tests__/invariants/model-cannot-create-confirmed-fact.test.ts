import { describe, it } from 'vitest';

/**
 * Invariant: generated text can never produce a CONFIRMED_FACT (write gate + DB constraint).
 * Implemented in Phase 04. Until then this placeholder keeps the invariant on the ledger
 * (docs/PROGRESS.md#invariant-test-ledger). Never delete; unskip in Phase 04.
 */
describe.skip('model-cannot-create-confirmed-fact (Phase 04)', () => {
  it('is implemented in Phase 04', () => {});
});
