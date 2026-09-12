/**
 * AI call telemetry + budget hook. The `ai_calls` table lands in Phase 04; until then the
 * default sink keeps records in memory. Records are content-free by type: IDs, counts, classes.
 */
import type { ObjectRef, RunStatus, TaskId } from './types';

export interface AiCallRecord {
  userId: string | null;
  task: TaskId;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  latencyMs: number;
  status: RunStatus;
  errorClass: string | null;
  attempts: number;
  objectRefs: ObjectRef[];
}

export interface AiTelemetrySink {
  record(rec: AiCallRecord): Promise<void>;
}

export type BudgetVerdict = { allowed: true } | { allowed: false; reason: 'daily' | 'monthly' };

/** Enforced before any provider call. Real limits arrive in Phase 11 (usage_counters). */
export interface BudgetPolicy {
  check(userId: string | undefined, task: TaskId): Promise<BudgetVerdict>;
}

export const unlimitedBudget: BudgetPolicy = {
  check: async () => ({ allowed: true }),
};

export class MemoryTelemetry implements AiTelemetrySink {
  readonly records: AiCallRecord[] = [];
  async record(rec: AiCallRecord): Promise<void> {
    this.records.push(rec);
  }
}

export const noopTelemetry: AiTelemetrySink = { record: async () => {} };
