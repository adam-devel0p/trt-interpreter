import type { InterpretationRow, SafetyFlagRow } from '@/db/queries/interpretations';
import type { InterpretationStore } from '@/interpretation/store';

/** In-memory `InterpretationStore` for the invariant tests. It has no way to touch a reading. */
export function memoryStore() {
  const rows: InterpretationRow[] = [];
  const flags: SafetyFlagRow[] = [];
  let n = 0;
  const store: InterpretationStore = {
    async createPending(input) {
      const row: InterpretationRow = {
        id: `int-${++n}`,
        reading_id: input.readingId,
        user_id: input.userId,
        status: 'pending',
        fact_status: 'TAROT_INTERPRETATION',
        metadata_version: input.metadataVersion,
        depth: input.depth,
        synthesis: null,
        per_card: null,
        combined: null,
        reflective_prompts: null,
        model_id: null,
        prompt_version: input.promptVersion,
        schema_version: input.schemaVersion,
        tokens_in: null,
        tokens_out: null,
        cost_micros: null,
        latency_ms: null,
        error_class: null,
        feedback: null,
        feedback_reason: null,
        feedback_at: null,
        superseded_by: null,
        generated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
    async updatePartial(id, partial) {
      const r = rows.find((x) => x.id === id)!;
      if (r.status === 'complete') return;
      r.status = 'streaming';
      r.synthesis = partial.synthesis ?? null;
      r.per_card = partial.per_card ?? null;
      r.combined = partial.combined ?? null;
      r.reflective_prompts = partial.reflective_prompts ?? null;
    },
    async complete(id, readingId, input) {
      for (const o of rows) {
        if (
          o.reading_id === readingId &&
          o.status === 'complete' &&
          o.superseded_by === null &&
          o.id !== id
        ) {
          o.superseded_by = id;
        }
      }
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, {
        status: 'complete',
        synthesis: input.output.synthesis,
        per_card: input.output.per_card,
        combined: input.output.combined,
        reflective_prompts: input.output.reflective_prompts,
        model_id: input.modelId,
        tokens_in: input.tokensIn,
        tokens_out: input.tokensOut,
        cost_micros: input.costMicros,
        latency_ms: input.latencyMs,
        generated_at: new Date().toISOString(),
      });
      return r;
    },
    async fail(id, errorClass, meta) {
      const r = rows.find((x) => x.id === id)!;
      if (r.status === 'complete') return;
      r.status = 'failed';
      r.error_class = errorClass;
      r.latency_ms = meta?.latencyMs ?? null;
    },
    async recordSafetyFlag(input) {
      const flag: SafetyFlagRow = {
        id: `flag-${flags.length + 1}`,
        user_id: input.userId,
        object_type: input.objectType,
        object_id: input.objectId,
        category: input.category,
        severity: input.severity,
        surfaced_at: input.surfaced ? new Date().toISOString() : null,
        resource_shown: input.surfaced ? input.category : null,
        created_at: new Date().toISOString(),
      };
      flags.push(flag);
      return flag;
    },
  };
  return { store, rows, flags };
}
