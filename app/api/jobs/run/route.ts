import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/config/env.server';
import { runBatch } from '@/jobs/worker';
import { logger } from '@/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const secret = serverEnv().JOBS_RUN_SECRET;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Processes one bounded batch. Called by Vercel cron (set CRON_SECRET = JOBS_RUN_SECRET so the
 * automatic Authorization header matches) or locally by `pnpm jobs:run`.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const result = await runBatch();
  logger.info('jobs.batch', { count: result.claimed, durationMs: Date.now() - started });
  return NextResponse.json(result);
}

// Vercel cron invokes with GET; accept it with the same auth so a single route serves both.
export const GET = POST;
