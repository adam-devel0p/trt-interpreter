import { describe, expect, it } from 'vitest';
import { MODEL_ALLOWED, modelWrite, userWrite, WriteGateError } from '../writeGate';

describe('write gate (spec §9.2)', () => {
  it('lets a model write only derived statuses', () => {
    for (const s of MODEL_ALLOWED) expect(modelWrite(s, {}).fact_status).toBe(s);
    expect(() => modelWrite('CONFIRMED_FACT', {})).toThrow(WriteGateError);
    expect(() => modelWrite('USER_REFLECTION', {})).toThrow(WriteGateError);
    // A cast cannot get past the runtime check.
    expect(() => modelWrite('CONFIRMED_FACT' as never, {})).toThrow(WriteGateError);
  });

  it('lets a user action write any status', () => {
    expect(userWrite('CONFIRMED_FACT', { x: 1 })).toEqual({
      fact_status: 'CONFIRMED_FACT',
      payload: { x: 1 },
    });
    expect(() => userWrite('NOT_A_STATUS' as never, {})).toThrow(WriteGateError);
  });
});
