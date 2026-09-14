/**
 * AI call telemetry + budget hook. Records are content-free by type: IDs, counts, classes.
 * The database sink writes `ai_calls` through the service-role surface (this is the one file
 * in src/ai/ allowed to touch the database, by lint rule). Recording never throws into the
 * caller: a telemetry failure is logged by class and swallowed, the model result still stands.
 */
import { loadEntitlements } from '@/billing/gate';
import { recordUsage } from '@/billing/usage';
import { insertAiCall } from '@/db/admin';
import { featureForTask } from '@/domain/billing/entitlements';
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

export type BudgetVerdict =
  { allowed: true } | { allowed: false; reason: 'daily' | 'monthly' | 'plan' };

/** Enforced before any provider call (§13, §14). */
export interface BudgetPolicy {
  check(userId: string | undefined, task: TaskId): Promise<BudgetVerdict>;
}

export const unlimitedBudget: BudgetPolicy = {
  check: async () => ({ allowed: true }),
};

/**
 * The real budget (Phase 11): the user's plan and this month's counters through the one
 * entitlements function. A run without a user (system probes) is not metered. A failure to
 * *read* the budget lets the call through and logs it — the database that failed is the same
 * one every other step needs, so this is never the path that silently burns money.
 */
export class DbBudgetPolicy implements BudgetPolicy {
  async check(userId: string | undefined, task: TaskId): Promise<BudgetVerdict> {
    if (!userId) return { allowed: true };
    try {
      const verdict = (await loadEntitlements(userId)).features[featureForTask(task)];
      if (verdict.allowed) return { allowed: true };
      logger.info('ai.budget.denied', { userId, task, reason: verdict.reason ?? 'plan' });
      return { allowed: false, reason: verdict.reason ?? 'plan' };
    } catch (err) {
      logger.warn('ai.budget.check_failed', { userId, task, errorClass: errorClassOf(err) });
      return { allowed: true };
    }
  }
}

export class MemoryTelemetry implements AiTelemetrySink {
  readonly records: AiCallRecord[] = [];
  async record(rec: AiCallRecord): Promise<void> {
    this.records.push(rec);
  }
}

export const noopTelemetry: AiTelemetrySink = { record: async () => {} };

/** Persists every run to `ai_calls` and, for runs that reached the provider, `usage_counters`. */
export class DbTelemetry implements AiTelemetrySink {
  async record(rec: AiCallRecord): Promise<void> {
    if (rec.userId && rec.status !== 'budget_denied' && rec.errorClass !== 'circuit_open') {
      try {
        await recordUsage({
          userId: rec.userId,
          task: rec.task,
          ok: rec.status === 'ok',
          tokens: rec.tokensIn + rec.tokensOut,
          costMicros: rec.costMicros,
        });
      } catch (err) {
        logger.warn('ai.usage_record_failed', { errorClass: errorClassOf(err) });
      }
    }
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
