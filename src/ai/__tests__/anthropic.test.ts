import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../provider';
import { createAnthropicProvider } from '../providers/anthropic';
import { toOutputSchema } from '../providers/outputSchema';
import type { ResolvedCall } from '../types';

/**
 * The provider against a fake SDK client: request shape (structured output, effort by tier,
 * abort signal, no retries), error mapping to content-free classes, refusal and max_tokens as
 * terminal classes, cost from usage. The network path is verified manually once with a key.
 */

const schema = z
  .object({ synthesis: z.string().min(20), items: z.array(z.string()).max(3) })
  .strict();
const call = (tier: ResolvedCall['tier'] = 'deep'): ResolvedCall => ({
  modelId: 'claude-opus-5',
  tier,
  signal: new AbortController().signal,
});

function message(text: string, stop: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      speed: null,
      iterations: null,
      output_tokens_details: null,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

function fakeClient(impl: {
  create?: (
    params: Anthropic.MessageCreateParams,
    opts: { signal?: AbortSignal },
  ) => Promise<Anthropic.Message>;
  stream?: (params: Anthropic.MessageStreamParams) => {
    events: Anthropic.MessageStreamEvent[];
    final: Anthropic.Message;
  };
}) {
  const seen: {
    create?: Anthropic.MessageCreateParams;
    stream?: Anthropic.MessageStreamParams;
    signal?: AbortSignal;
  } = {};
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams, opts: { signal?: AbortSignal }) => {
        seen.create = params;
        seen.signal = opts.signal;
        return impl.create!(params, opts);
      },
      stream: (params: Anthropic.MessageStreamParams) => {
        seen.stream = params;
        const { events, final } = impl.stream!(params);
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of events) yield e;
          },
          finalMessage: async () => final,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, seen };
}

describe('toOutputSchema', () => {
  it('keeps structure, drops constraints the endpoint may reject, closes objects', () => {
    const out = toOutputSchema(schema) as Record<string, unknown>;
    expect(out.$schema).toBeUndefined();
    expect(out.type).toBe('object');
    expect(out.additionalProperties).toBe(false);
    expect((out.properties as Record<string, Record<string, unknown>>).synthesis).toEqual({
      type: 'string',
    });
    expect((out.properties as Record<string, Record<string, unknown>>).items).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(out.required).toEqual(['synthesis', 'items']);
  });
});

describe('anthropic provider', () => {
  it('generateObject sends the structured-output format, effort for the tier, the abort signal', async () => {
    const { client, seen } = fakeClient({
      create: async () =>
        message(JSON.stringify({ synthesis: 'A sentence long enough.', items: [] })),
    });
    const p = createAnthropicProvider({
      apiKey: 'k',
      client,
      versions: () => ({ promptVersion: 'p1', schemaVersion: 's1' }),
    });
    const c = call('deep');
    const r = await p.generateObject(
      {
        task: 'interpret_reading',
        system: 'sys',
        messages: [{ role: 'user', content: 'u' }],
        schema,
        maxTokens: 500,
      },
      c,
    );
    expect(r.value).toEqual({ synthesis: 'A sentence long enough.', items: [] });
    expect(r.meta).toMatchObject({
      modelId: 'claude-opus-5',
      promptVersion: 'p1',
      schemaVersion: 's1',
      tokensIn: 1000,
      tokensOut: 100,
    });
    expect(r.meta.costMicros).toBe(1000 * 5 + 100 * 25);
    expect(seen.create?.model).toBe('claude-opus-5');
    expect(seen.create?.max_tokens).toBe(500);
    expect(seen.create?.output_config?.format?.type).toBe('json_schema');
    expect(seen.create?.output_config?.effort).toBe('medium');
    expect(seen.signal).toBe(c.signal);
  });

  it('never sets effort for the fast tier', async () => {
    const { client, seen } = fakeClient({
      create: async () => message('{"synthesis":"x","items":[]}'),
    });
    const p = createAnthropicProvider({ apiKey: 'k', client });
    await p.generateObject(
      { task: 'classify_safety', system: 's', messages: [], schema: z.any(), maxTokens: 64 },
      call('fast'),
    );
    expect(seen.create?.output_config?.effort).toBeUndefined();
  });

  it.each([
    [new Anthropic.RateLimitError(429, {}, 'rate', new Headers()), 'rate_limited'],
    [new Anthropic.InternalServerError(500, {}, 'boom', new Headers()), 'server_error'],
    [new Anthropic.APIConnectionError({ message: 'conn' }), 'server_error'],
    [new Anthropic.APIConnectionTimeoutError({ message: 't' }), 'timeout'],
    [new Anthropic.BadRequestError(400, {}, 'bad', new Headers()), 'unknown'],
    [new Error('anything else'), 'unknown'],
  ])('maps %s to a content-free class', async (err, cls) => {
    const { client } = fakeClient({
      create: async () => {
        throw err;
      },
    });
    const p = createAnthropicProvider({ apiKey: 'k', client });
    const e = await p
      .generateObject(
        { task: 'classify_safety', system: 's', messages: [], schema: z.any(), maxTokens: 64 },
        call('fast'),
      )
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiProviderError);
    expect((e as AiProviderError).errorClass).toBe(cls);
    expect((e as AiProviderError).message).not.toContain('boom');
  });

  it('refusal and max_tokens stop reasons become terminal classes', async () => {
    for (const [stop, cls] of [
      ['refusal', 'refusal'],
      ['max_tokens', 'invalid_output'],
    ] as const) {
      const { client } = fakeClient({ create: async () => message('{}', stop) });
      const p = createAnthropicProvider({ apiKey: 'k', client });
      const e = await p
        .generateObject(
          { task: 'classify_safety', system: 's', messages: [], schema: z.any(), maxTokens: 64 },
          call('fast'),
        )
        .catch((x: unknown) => x);
      expect((e as AiProviderError).errorClass).toBe(cls);
    }
  });

  it('generateStream yields text deltas then done with usage-based cost; refusal throws after the stream', async () => {
    const json = JSON.stringify({ synthesis: 'Streamed sentence, long enough.', items: ['x'] });
    const delta = (text: string): Anthropic.MessageStreamEvent => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    });
    const { client, seen } = fakeClient({
      stream: () => ({
        events: [delta(json.slice(0, 10)), delta(json.slice(10))],
        final: message(json),
      }),
    });
    const p = createAnthropicProvider({ apiKey: 'k', client });
    const chunks = [];
    for await (const c of p.generateStream(
      {
        task: 'interpret_reading',
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema,
        maxTokens: 800,
      },
      call('deep'),
    ))
      chunks.push(c);
    expect(
      chunks
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join(''),
    ).toBe(json);
    expect(chunks.at(-1)).toMatchObject({ type: 'done', meta: { tokensIn: 1000, tokensOut: 100 } });
    expect(seen.stream?.output_config?.format?.type).toBe('json_schema');

    const refusing = fakeClient({ stream: () => ({ events: [], final: message('', 'refusal') }) });
    const p2 = createAnthropicProvider({ apiKey: 'k', client: refusing.client });
    const run = async () => {
      for await (const _c of p2.generateStream(
        { task: 'interpret_reading', system: 's', messages: [], maxTokens: 10 },
        call(),
      )) {
        /* drain */
      }
    };
    await expect(run()).rejects.toMatchObject({ errorClass: 'refusal' });
  });

  it('has no embedding model', async () => {
    const p = createAnthropicProvider({ apiKey: 'k', client: fakeClient({}).client });
    await expect(p.embed({ task: 'detect_repeat_question', texts: ['q'] })).rejects.toMatchObject({
      errorClass: 'unsupported',
    });
  });
});
