/**
 * AI call telemetry + budget hook. Records are content-free by type: IDs, counts, classes.
 * The database sink writes `ai_calls` through the service-role surface (this is the one file
 * in src/ai/ allowed to touch the database, by lint rule). Recording never throws into the
 * caller: a telemetry failure is logged by class and swallowed, the model result still stands.
 */
import { insertAiCall } from '@/db/admin';
import { errorClassOf, logger } from '@/observability/logger';
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

/** Persists every run to `ai_calls`. */
export class DbTelemetry implements AiTelemetrySink {
  async record(rec: AiCallRecord): Promise<void> {
    try {
      await insertAiCall({
        userId: rec.userId,
        task: rec.task,
        modelId: rec.modelId,
        promptVersion: rec.promptVersion,
        schemaVersion: rec.schemaVersion,
        tokensIn: rec.tokensIn,
        tokensOut: rec.tokensOut,
        costMicros: rec.costMicros,
        latencyMs: rec.latencyMs,
        status: rec.status,
        errorClass: rec.errorClass,
        attempts: rec.attempts,
        objectRefs: rec.objectRefs,
      });
    } catch (err) {
      logger.warn('ai.telemetry_failed', { errorClass: errorClassOf(err) });
    }
  }
}

/** Fan-out: memory for tests and the health probe, database for the ledger. */
export class MultiTelemetry implements AiTelemetrySink {
  constructor(private readonly sinks: AiTelemetrySink[]) {}
  async record(rec: AiCallRecord): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.record(rec)));
  }
}
