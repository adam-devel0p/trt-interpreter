import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { interpretations } from '@/db/schema/ai';
import { MODEL_ALLOWED, modelWrite, USER_ONLY, WriteGateError } from '@/domain/facts/writeGate';

/**
 * Invariant 7 (spec §9.2): generated text can never produce a CONFIRMED_FACT. Three layers:
 *   1. the write gate — `modelWrite()` refuses every user-only status at runtime;
 *   2. the query layer — every interpretation write goes through the gate, so the row that
 *      reaches PostgREST always carries TAROT_INTERPRETATION;
 *   3. the database — `interpretations.fact_status` has a check constraint fixing the value
 *      (declared in the Drizzle schema and present in the migration; the live constraint is
 *      exercised against Postgres in `src/interpretation/__tests__/interpretation.integration.test.ts`).
 */
describe('model-cannot-create-confirmed-fact', () => {
  it('1 · modelWrite() rejects CONFIRMED_FACT and USER_REFLECTION, allows only derived statuses', () => {
    for (const s of USER_ONLY)
      expect(() => modelWrite(s, { anything: true })).toThrow(WriteGateError);
    expect(MODEL_ALLOWED).not.toContain('CONFIRMED_FACT');
    expect(MODEL_ALLOWED).not.toContain('USER_REFLECTION');
    expect(modelWrite('TAROT_INTERPRETATION', {}).fact_status).toBe('TAROT_INTERPRETATION');
  });

  it('2 · every interpretation write the query layer sends carries TAROT_INTERPRETATION', async () => {
    const { createPendingInterpretation, completeInterpretation, updateInterpretationPartial } =
      await import('@/db/queries/interpretations');
    const writes: Record<string, unknown>[] = [];
    const builder = {
      insert: (row: Record<string, unknown>) => {
        writes.push(row);
        return builder;
      },
      update: (row: Record<string, unknown>) => {
        writes.push(row);
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      neq: () => builder,
      single: async () => ({
        data: { id: 'x', fact_status: writes.at(-1)?.fact_status },
        error: null,
      }),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    const client = { from: () => builder } as never;
    await createPendingInterpretation(client, {
      readingId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      metadataVersion: 1,
      depth: 'standard',
      promptVersion: 'p',
      schemaVersion: 's',
    });
    await updateInterpretationPartial(client, 'x', { synthesis: 'partial' });
    await completeInterpretation(client, 'x', '00000000-0000-4000-8000-000000000001', {
      output: {
        synthesis: 'A sentence long enough to pass.',
        per_card: [
          {
            position_index: 0,
            card_id: '00000000-0000-4000-8000-000000000010',
            text: 'Forty characters of card text, at least this long.',
            nuances: [],
          },
        ],
        combined: 'Forty characters of combined text, at least this long.',
        reflective_prompts: ['What would change?', 'What stays the same?'],
      },
      modelId: 'm',
      promptVersion: 'p',
      schemaVersion: 's',
      tokensIn: 1,
      tokensOut: 1,
      costMicros: 0,
      latencyMs: 1,
    });
    const insert = writes[0]!;
    expect(insert.fact_status).toBe('TAROT_INTERPRETATION');
    for (const w of writes) {
      if ('fact_status' in w) expect(w.fact_status).toBe('TAROT_INTERPRETATION');
      expect(JSON.stringify(w)).not.toContain('CONFIRMED_FACT');
    }
  });

  it('3 · the schema and migration fix fact_status by check constraint', () => {
    const cfg = getTableConfig(interpretations);
    const check = cfg.checks.find((c) => c.name === 'interpretations_fact_status_check');
    expect(check).toBeDefined();
    const col = cfg.columns.find((c) => c.name === 'fact_status');
    expect(col?.default).toBe('TAROT_INTERPRETATION');
    const sql = readFileSync(path.resolve('src/db/migrations/0005_ai_interpretation.sql'), 'utf8');
    expect(sql).toMatch(
      /CONSTRAINT "interpretations_fact_status_check" CHECK \("interpretations"\."fact_status" = 'TAROT_INTERPRETATION'\)/,
    );
  });
});
