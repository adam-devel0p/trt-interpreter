import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAiRunner } from '@/ai';
import { getSessionClient, getUser } from '@/auth/session';
import { getInterpretationState, listSafetyFlags } from '@/db/queries/interpretations';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { getReading } from '@/db/queries/readings';
import type { ServiceEvent } from '@/interpretation/events';
import {
  cancelRun,
  findLiveForReading,
  publish,
  registerRun,
  subscribe,
} from '@/interpretation/live';
import { runInterpretation } from '@/interpretation/service';
import { dbStore } from '@/interpretation/store';
import { errorClassOf, logger } from '@/observability/logger';

export const dynamic = 'force-dynamic';

/**
 * Interpretation endpoint (§9.3, §13). The reading already exists — this route can fail freely
 * without data loss. POST starts (or attaches to) a run and streams server-sent events; GET
 * returns the stored state for polling; DELETE cancels a run in flight.
 *
 * A stored, current interpretation is returned as JSON with no model call (invariant: opening
 * never re-calls). Regeneration is explicit (`{ regenerate: true }`), metered like any other
 * call, and supersedes rather than overwrites.
 */

const IN_PROGRESS_FRESH_MS = 3 * 60 * 1000;
const bodySchema = z.object({ regenerate: z.boolean().optional() }).strict();

function sse(events: AsyncIterable<ServiceEvent>): Response {
  const encoder = new TextEncoder();
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of events) {
          if (stopped) break;
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
          if (e.type === 'complete' || e.type === 'failed') break;
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: 404 as const };
  const user = await getUser();
  if (!user) return { error: 401 as const };
  const client = await getSessionClient();
  const reading = await getReading(client, id);
  if (!reading) return { error: 404 as const };
  const profile = await getProfile(client, user.id);
  if (!profile) return { error: 401 as const };
  return { user, client, reading, profile };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const l = await load(id);
  if ('error' in l) return NextResponse.json({ error: l.error }, { status: l.error });
  const [state, flags] = await Promise.all([
    getInterpretationState(l.client, id),
    listSafetyFlags(l.client, 'reading', id),
  ]);
  return NextResponse.json({
    ...state,
    safetyFlags: flags,
    live: findLiveForReading(id) !== null,
    metadataVersion: l.reading.metadata_version,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const l = await load(id);
  if ('error' in l) return NextResponse.json({ error: l.error }, { status: l.error });
  const { client, reading, profile, user } = l;
  if (!hasAiConsent(profile)) return NextResponse.json({ kind: 'consent' }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const regenerate = parsed.success ? (parsed.data.regenerate ?? false) : false;

  const live = findLiveForReading(id);
  if (live) return sse(subscribe(live));

  if (!regenerate) {
    const state = await getInterpretationState(client, id);
    if (state.current && state.current.metadata_version === reading.metadata_version) {
      return NextResponse.json({ kind: 'stored', interpretation: state.current });
    }
    const latest = state.latest;
    if (
      latest &&
      (latest.status === 'pending' || latest.status === 'streaming') &&
      Date.now() - Date.parse(latest.updated_at) < IN_PROGRESS_FRESH_MS
    ) {
      return NextResponse.json({ kind: 'in_progress', interpretation: latest });
    }
  }

  const runKey = randomUUID();
  const abort = registerRun(runKey, id);
  const task = (async () => {
    try {
      for await (const e of runInterpretation({
        reading,
        profile,
        store: dbStore(client),
        runner: getAiRunner(),
        signal: abort.signal,
      })) {
        publish(runKey, e);
      }
    } catch (err) {
      logger.error('ai.interpretation.task_crashed', {
        userId: user.id,
        objectId: id,
        errorClass: errorClassOf(err),
      });
      publish(runKey, {
        type: 'failed',
        interpretationId: '',
        errorClass: 'provider_error',
        message:
          'Interpretation is unavailable. Your reading is saved and complete; try again later.',
      });
    }
  })();
  // Keep the run alive when the client disconnects; persistence, not the socket, is the truth.
  after(() => task);
  return sse(subscribe(runKey));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const l = await load(id);
  if ('error' in l) return NextResponse.json({ error: l.error }, { status: l.error });
  const live = findLiveForReading(id);
  const cancelled = live ? cancelRun(live) : false;
  return NextResponse.json({ cancelled });
}
