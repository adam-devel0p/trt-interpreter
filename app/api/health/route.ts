import { NextResponse } from 'next/server';
import { describeProviderConfig } from '@/ai';
import { latestAppliedMigration, pingDatabase } from '@/db/admin';
import { logger } from '@/observability/logger';
import journal from '@/db/migrations/meta/_journal.json';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness. DB reachable, migrations current (latest journal entry applied),
 * provider configured. Makes no model call. Returns 503 when anything is off.
 */
export async function GET() {
  const started = Date.now();
  const expected = journal.entries.at(-1);
  let db = false;
  let migration: { current: boolean; expected: string; appliedAt: number | null } = {
    current: false,
    expected: expected?.tag ?? 'none',
    appliedAt: null,
  };
  try {
    db = await pingDatabase();
    const latest = await latestAppliedMigration();
    migration = {
      current: !!latest && !!expected && latest.createdAt >= expected.when,
      expected: expected?.tag ?? 'none',
      appliedAt: latest?.createdAt ?? null,
    };
  } catch (err) {
    logger.error('health.db_failed', { errorClass: err instanceof Error ? err.name : 'unknown' });
  }
  const provider = describeProviderConfig();
  const ok = db && migration.current && provider.configured && provider.routing;
  const body = {
    status: ok ? 'ok' : 'degraded',
    db,
    migration,
    provider,
    durationMs: Date.now() - started,
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
