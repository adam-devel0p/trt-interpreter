import { describe, expect, it } from 'vitest';
import { createOpenAiEmbeddings } from '../providers/openai-embeddings';

function fetchWith(status: number, body: unknown): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    (fetchWith as unknown as { last?: RequestInit }).last = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('openai embeddings adapter', () => {
  it('posts the texts, returns vectors in index order, prices by tokens', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen.push(init!);
      return new Response(
        JSON.stringify({
          model: 'text-embedding-3-small',
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
          usage: { prompt_tokens: 50 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const e = createOpenAiEmbeddings({
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      fetchImpl,
    });
    const r = await e.embed({ task: 'detect_repeat_question', texts: ['a', 'b'] });
    expect(r.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(r.meta).toMatchObject({
      modelId: 'text-embedding-3-small',
      tokensIn: 50,
      costMicros: 1,
    });
    const body = JSON.parse(String(seen[0]!.body)) as { input: string[]; model: string };
    expect(body.input).toEqual(['a', 'b']);
    expect((seen[0]!.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'server_error'],
    [401, 'unknown'],
  ])('maps HTTP %s to %s', async (status, cls) => {
    const e = createOpenAiEmbeddings({ apiKey: 'k', model: 'm', fetchImpl: fetchWith(status, {}) });
    await expect(e.embed({ task: 'detect_repeat_question', texts: ['a'] })).rejects.toMatchObject({
      errorClass: cls,
    });
  });

  it('a count mismatch is invalid output', async () => {
    const e = createOpenAiEmbeddings({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchWith(200, { data: [], usage: { prompt_tokens: 1 } }),
    });
    await expect(e.embed({ task: 'detect_repeat_question', texts: ['a'] })).rejects.toMatchObject({
      errorClass: 'invalid_output',
    });
  });
});
