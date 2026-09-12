import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { platformDb, platformSql } from '@/db/admin';
import { jobs } from '@/db/schema';
import { enqueue } from '../enqueue';
import { backoffMs, runBatch } from '../worker';

async function load(id: string) {
  const [row] = await platformDb().select().from(jobs).where(eq(jobs.id, id));
  if (!row) throw new Error('job missing');
  return row;
}

/** Make a retried job runnable now (the worker scheduled it for the future). */
async function makeDue(id: string) {
  await platformSql()`update jobs set run_after = now() - interval '1 second' where id = ${id}`;
}

describe('job worker', () => {
  it('success: claims, runs, marks succeeded', async () => {
    const { id } = await enqueue('noop_echo', { echo: 'hello' });
    const result = await runBatch({ limit: 10 });
    expect(result).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
    const job = await load(id);
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBe(1);
    expect(job.lockedAt).toBeNull();
  });

  it('retry: a failing attempt is re-queued with backoff and succeeds later', async () => {
    const { id } = await enqueue('noop_echo', { failUntilAttempt: 2 }, { maxAttempts: 3 });
    const first = await runBatch();
    expect(first).toMatchObject({ claimed: 1, retried: 1, succeeded: 0, dead: 0 });
    let job = await load(id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.lastErrorClass).toBe('NoopEchoInducedFailure');
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());

    // Not due yet → not claimed.
    expect((await runBatch()).claimed).toBe(0);

    await makeDue(id);
    const second = await runBatch();
    expect(second).toMatchObject({ claimed: 1, succeeded: 1 });
    job = await load(id);
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBe(2);
  });

  it('dead-letter: after max_attempts the job is dead and never claimed again', async () => {
    const { id } = await enqueue('noop_echo', { failUntilAttempt: 99 }, { maxAttempts: 2 });
    expect(await runBatch()).toMatchObject({ retried: 1 });
    await makeDue(id);
    expect(await runBatch()).toMatchObject({ dead: 1 });
    const job = await load(id);
    expect(job.status).toBe('dead');
    expect(job.attempts).toBe(2);
    expect(job.lastErrorClass).toBe('NoopEchoInducedFailure');
    await makeDue(id);
    expect((await runBatch()).claimed).toBe(0);
  });

  it('unknown kinds are dead immediately; bad payloads fail at enqueue', async () => {
    await expect(enqueue('does_not_exist', {})).rejects.toThrow(/Unknown job kind/);
    await expect(enqueue('noop_echo', { failUntilAttempt: 'x' })).rejects.toThrow();
    await platformDb().insert(jobs).values({ kind: 'legacy_kind', payload: {} });
    expect(await runBatch()).toMatchObject({ claimed: 1, dead: 1 });
  });

  it('respects the batch limit and orders by run_after', async () => {
    for (let i = 0; i < 3; i++) await enqueue('noop_echo', { echo: String(i) });
    expect((await runBatch({ limit: 2 })).claimed).toBe(2);
    expect((await runBatch({ limit: 2 })).claimed).toBe(1);
  });

  it('backoff grows exponentially and is capped', () => {
    const fixed = () => 0.5;
    expect(backoffMs(1, fixed)).toBe(2000);
    expect(backoffMs(2, fixed)).toBe(4000);
    expect(backoffMs(30, fixed)).toBe(60 * 60_000);
  });
});
