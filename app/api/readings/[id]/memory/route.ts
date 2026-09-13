import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getReadingMemory } from '@/db/queries/memory';
import { getReading } from '@/db/queries/readings';

export const dynamic = 'force-dynamic';

/**
 * The stored structured memory of a reading, for the detail screen to poll while an
 * extraction is queued. Reads rows only; never calls a model.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await requireUser();
  const client = await getSessionClient();
  const reading = await getReading(client, id);
  if (!reading) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const memory = await getReadingMemory(client, reading);
  return NextResponse.json(memory, { headers: { 'cache-control': 'no-store' } });
}
