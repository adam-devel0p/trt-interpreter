import { NextResponse } from 'next/server';
import { track } from '@/analytics/track';
import { z } from 'zod';
import { getAiRunner, getEmbedder } from '@/ai';
import { getSessionClient, getUser } from '@/auth/session';
import { checkFeatureFor } from '@/billing/gate';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { askQuestionSchema, askScopeSchema } from '@/domain/retrieval/query';
import { flag } from '@/flags';
import { logger } from '@/observability/logger';
import { askHistory, type AskEvent } from '@/retrieval/ask';

export const dynamic = 'force-dynamic';

/**
 * Ask My History (§6.6, §8.1). POST starts a run and streams its stages as server-sent
 * events, then the verified answer; the row is stored before the stream ends, so a
 * disconnect after `complete` loses nothing. Closing the stream cancels the run at the next
 * step boundary. Gated by consent and the `ask_my_history` flag; nothing here is reachable
 * from the reading routes.
 */

const bodySchema = z
  .object({ question: askQuestionSchema, scope: askScopeSchema.default({ kind: 'all' }) })
  .strict();

function sse(
  events: AsyncGenerator<AskEvent>,
  abort: AbortController,
  onComplete?: (e: Extract<AskEvent, { type: 'complete' }>) => void,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of events) {
          if (abort.signal.aborted) break;
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
          if (e.type === 'complete') onComplete?.(e);
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
      abort.abort();
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

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 401 }, { status: 401 });
  const client = await getSessionClient();
  const profile = await getProfile(client, user.id);
  if (!profile) return NextResponse.json({ error: 401 }, { status: 401 });
  if (!(await flag('ask_my_history', { userId: user.id })))
    return NextResponse.json({ kind: 'off' }, { status: 403 });
  if (!hasAiConsent(profile)) return NextResponse.json({ kind: 'consent' }, { status: 403 });
  // Premium (§14): the verdict comes from the one gate; a denial here means no model call.
  const verdict = await checkFeatureFor(user.id, 'ask_my_history');
  if (!verdict.allowed)
    return NextResponse.json(
      { kind: verdict.reason === 'plan' ? 'plan' : 'limit', reason: verdict.reason },
      { status: 403 },
    );
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ kind: 'invalid' }, { status: 400 });

  const abort = new AbortController();
  req.signal?.addEventListener('abort', () => abort.abort(), { once: true });
  logger.info('ask.started', { userId: user.id, stage: parsed.data.scope.kind });
  const events = askHistory({
    client,
    userId: user.id,
    question: parsed.data.question,
    scope: parsed.data.scope,
    runner: getAiRunner(),
    embedder: getEmbedder(),
    signal: abort.signal,
  });
  return sse(events, abort, (e) =>
    track(user.id, 'ask_asked', {
      scope: parsed.data.scope.kind,
      sufficient: e.result.answer.evidence_sufficient,
    }),
  );
}
