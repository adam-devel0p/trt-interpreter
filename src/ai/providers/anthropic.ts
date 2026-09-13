/**
 * Anthropic provider (docs/AI_LAYER.md#provider-interface). One attempt per call; `run.ts` owns
 * retries, timeouts, repair and the breaker, so `maxRetries` is 0 here and the runner's abort
 * signal is passed straight through. Errors are mapped to content-free classes. No prompt or
 * completion text is logged or thrown.
 */
import Anthropic from '@anthropic-ai/sdk';
import { costMicros } from '../pricing';
import { AiProviderError, type AiProvider } from '../provider';
import type {
  EmbedRequest,
  EmbedResult,
  ObjectRequest,
  ObjectResult,
  ResolvedCall,
  ResultMeta,
  StreamChunk,
  StreamRequest,
} from '../types';
import { toOutputSchema } from './outputSchema';

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Prompt/schema versions are stamped by the task layer; the provider echoes what it is given. */
  versions?: (task: string) => { promptVersion: string; schemaVersion: string };
  /** `output_config.effort` for tiers whose models support it (deep/standard). */
  effort?: { deep?: Effort; standard?: Effort };
  client?: Anthropic;
}

type Effort = 'low' | 'medium' | 'high';

const DEFAULT_EFFORT: { deep: Effort; standard: Effort } = { deep: 'medium', standard: 'medium' };

function mapError(err: unknown, signal: AbortSignal): AiProviderError {
  if (err instanceof AiProviderError) return err;
  if (signal.aborted) return new AiProviderError('timeout', 'aborted');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('timeout');
  if (err instanceof Anthropic.RateLimitError) return new AiProviderError('rate_limited', '429');
  if (err instanceof Anthropic.InternalServerError)
    return new AiProviderError('server_error', '5xx');
  if (err instanceof Anthropic.APIConnectionError)
    return new AiProviderError('server_error', 'conn');
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 529) return new AiProviderError('server_error', '529');
    return new AiProviderError('unknown', `http_${status}`);
  }
  if (err instanceof Error && err.name === 'AbortError') return new AiProviderError('timeout');
  return new AiProviderError('unknown');
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): AiProvider {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });
  const versions = opts.versions ?? (() => ({ promptVersion: '', schemaVersion: '' }));
  const effort = { ...DEFAULT_EFFORT, ...opts.effort };

  function meta(
    task: string,
    modelId: string,
    usage: { input_tokens: number; output_tokens: number },
    started: number,
  ): ResultMeta {
    const v = versions(task);
    return {
      modelId,
      promptVersion: v.promptVersion,
      schemaVersion: v.schemaVersion,
      tokensIn: usage.input_tokens,
      tokensOut: usage.output_tokens,
      costMicros: costMicros(modelId, usage.input_tokens, usage.output_tokens),
      latencyMs: Date.now() - started,
      repaired: false,
    };
  }

  function outputConfig(tier: ResolvedCall['tier'], schema?: Record<string, unknown>) {
    const cfg: Anthropic.OutputConfig = {};
    if (tier === 'deep') cfg.effort = effort.deep;
    if (tier === 'standard') cfg.effort = effort.standard;
    if (schema) cfg.format = { type: 'json_schema', schema };
    return cfg;
  }

  return {
    id: 'anthropic',

    async generateObject<T>(req: ObjectRequest<T>, call: ResolvedCall): Promise<ObjectResult<T>> {
      const started = Date.now();
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model: call.modelId,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
            output_config: outputConfig(call.tier, toOutputSchema(req.schema)),
          },
          { signal: call.signal },
        );
      } catch (err) {
        throw mapError(err, call.signal);
      }
      if (message.stop_reason === 'refusal') throw new AiProviderError('refusal');
      if (message.stop_reason === 'max_tokens') {
        throw new AiProviderError('invalid_output', 'max_tokens');
      }
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new AiProviderError('invalid_output', 'not_json');
      }
      return { value: value as T, meta: meta(req.task, call.modelId, message.usage, started) };
    },

    async *generateStream(req: StreamRequest, call: ResolvedCall): AsyncIterable<StreamChunk> {
      const started = Date.now();
      const stream = client.messages.stream(
        {
          model: call.modelId,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          output_config: outputConfig(
            call.tier,
            req.schema ? toOutputSchema(req.schema) : undefined,
          ),
        },
        { signal: call.signal },
      );
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') throw new AiProviderError('refusal');
        if (final.stop_reason === 'max_tokens') {
          throw new AiProviderError('invalid_output', 'max_tokens');
        }
        yield { type: 'done', meta: meta(req.task, call.modelId, final.usage, started) };
      } catch (err) {
        throw mapError(err, call.signal);
      }
    },

    async embed(_req: EmbedRequest): Promise<EmbedResult> {
      throw new AiProviderError('unsupported', 'anthropic has no embedding model');
    },
  };
}
