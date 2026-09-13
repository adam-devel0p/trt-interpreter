/**
 * The narrow service-role surface. Add purpose-named functions here; do not re-export the raw
 * client to the rest of the tree.
 */
import { desc, sql } from 'drizzle-orm';
import { aiCalls } from '@/db/schema/ai';
import { adminDb, adminSql, adminSupabase, closeAdmin } from './client';

export { closeAdmin };

/** Health probe: is the database reachable? */
export async function pingDatabase(): Promise<boolean> {
  const rows = await adminSql()`select 1 as ok`;
  return rows[0]?.ok === 1;
}

/** Latest applied Drizzle migration tag, or null if the migrations table is absent. */
export async function latestAppliedMigration(): Promise<{
  hash: string;
  createdAt: number;
} | null> {
  try {
    const rows = await adminSql()<{ hash: string; created_at: string }[]>`
      select hash, created_at from drizzle.__drizzle_migrations
      order by created_at desc limit 1`;
    const row = rows[0];
    return row ? { hash: row.hash, createdAt: Number(row.created_at) } : null;
  } catch {
    return null;
  }
}

/** Drizzle handle for platform modules (jobs, flags). Still service-role: use with care. */
export function platformDb() {
  return adminDb();
}

/** Raw SQL for tests and scripts. */
export function platformSql() {
  return adminSql();
}

/** auth.admin surface: create/delete users (tests, account deletion). */
export function authAdmin() {
  return adminSupabase().auth.admin;
}

/** Test/seed helper: truncate the given public tables. Refuses to run in production. */
export async function truncateTables(tables: readonly string[]): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('truncateTables refused in production');
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t}"`).join(', ');
  await adminDb().execute(sql.raw(`truncate table ${list} restart identity cascade`));
}

/** Content-free AI call record, as `src/ai/telemetry.ts` hands it over. */
export interface AiCallInsert {
  userId: string | null;
  task: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  latencyMs: number;
  status: 'ok' | 'invalid_output' | 'timeout' | 'provider_error' | 'budget_denied' | 'refusal';
  errorClass: string | null;
  attempts: number;
  objectRefs: { type: string; id: string }[];
}

/** One `ai_calls` row per run (§13 telemetry). The table has no policies: service role only. */
export async function insertAiCall(rec: AiCallInsert): Promise<void> {
  await adminDb().insert(aiCalls).values({
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
}

export interface AiUsageRow {
  task: string;
  modelId: string;
  calls: number;
  ok: number;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorClasses: Record<string, number>;
}

/** Aggregates for the dev usage page: by task and model, over the last `days`. */
export async function aiUsageSince(days: number): Promise<AiUsageRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await adminSql()<
    {
      task: string;
      model_id: string;
      calls: number;
      ok: number;
      tokens_in: number;
      tokens_out: number;
      cost_micros: number;
      p50: number;
      p95: number;
      error_classes: Record<string, number>;
    }[]
  >`
    with c as (
      select task, model_id, status, tokens_in, tokens_out, cost_micros, latency_ms, error_class
      from public.ai_calls where created_at >= ${since}::timestamptz
    )
    select
      task, model_id,
      count(*)::int as calls,
      (count(*) filter (where status = 'ok'))::int as ok,
      coalesce(sum(tokens_in), 0)::int as tokens_in,
      coalesce(sum(tokens_out), 0)::int as tokens_out,
      coalesce(sum(cost_micros), 0)::int as cost_micros,
      coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int as p50,
      coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::int as p95,
      (select coalesce(jsonb_object_agg(e.error_class, e.n), '{}'::jsonb)
         from (select error_class, count(*)::int as n from c c2
                where c2.task = c.task and c2.model_id = c.model_id and c2.error_class is not null
                group by 1) e) as error_classes
    from c
    group by 1, 2
    order by calls desc`;
  return rows.map((r) => ({
    task: r.task,
    modelId: r.model_id,
    calls: r.calls,
    ok: r.ok,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costMicros: r.cost_micros,
    p50LatencyMs: r.p50,
    p95LatencyMs: r.p95,
    errorClasses: r.error_classes,
  }));
}

/** Recent rows for the dev usage page and the content-free assertion. Never returns text. */
export async function recentAiCalls(limit = 50) {
  return adminDb().select().from(aiCalls).orderBy(desc(aiCalls.createdAt)).limit(limit);
}
