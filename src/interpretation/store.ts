/**
 * Persistence seam for the interpretation service. The database implementation wraps the
 * query layer; the invariant test substitutes memory so it can assert the service has no way
 * to touch the reading. Note what is absent: nothing here can write to `readings`.
 */
import type { UserClient } from '@/db/client';
import {
  completeInterpretation,
  createPendingInterpretation,
  failInterpretation,
  recordSafetyFlag,
  updateInterpretationPartial,
  type CompleteInput,
  type CreatePendingInput,
  type InterpretationRow,
  type SafetyFlagRow,
} from '@/db/queries/interpretations';
import type {
  InterpretationErrorClass,
  PartialInterpretation,
} from '@/domain/interpretation/schema';
import type { SafetyCategory, SafetySeverity } from '@/domain/safety/categories';

export interface InterpretationStore {
  createPending(input: CreatePendingInput): Promise<InterpretationRow>;
  updatePartial(id: string, partial: PartialInterpretation): Promise<void>;
  complete(id: string, readingId: string, input: CompleteInput): Promise<InterpretationRow>;
  fail(
    id: string,
    errorClass: InterpretationErrorClass | string,
    meta?: { modelId?: string; latencyMs?: number },
  ): Promise<void>;
  recordSafetyFlag(input: {
    userId: string;
    objectType: 'reading';
    objectId: string;
    category: Exclude<SafetyCategory, 'none'>;
    severity: SafetySeverity;
    surfaced: boolean;
  }): Promise<SafetyFlagRow>;
}

export function dbStore(client: UserClient): InterpretationStore {
  return {
    createPending: (input) => createPendingInterpretation(client, input),
    updatePartial: (id, partial) => updateInterpretationPartial(client, id, partial),
    complete: (id, readingId, input) => completeInterpretation(client, id, readingId, input),
    fail: (id, errorClass, meta) => failInterpretation(client, id, errorClass, meta),
    recordSafetyFlag: (input) => recordSafetyFlag(client, input),
  };
}
