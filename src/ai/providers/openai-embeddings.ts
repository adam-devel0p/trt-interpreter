/**
 * Minimal embeddings adapter (question similarity in Phase 04; retrieval documents and Ask
 * questions since Phase 09). Only the text handed to it is sent — a question, or the stored
 * compact retrieval document — never notes. Plain `fetch`; no SDK. Same content-free error
 * classes as every other provider.
 */
import { costMicros } from '../pricing';
import { AiProviderError } from '../provider';
import type { EmbedRequest, EmbedResult } from '../types';

export interface EmbeddingsProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface Embedder {
  readonly id: string;
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

interface EmbeddingsResponse {
  data: { index: number; embedding: number[] }[];
  model: string;
  usage: { prompt_tokens: number };
}

export function createOpenAiEmbeddings(opts: EmbeddingsProviderOptions): Embedder {
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return {
    id: 'openai-embeddings',
    async embed(req: EmbedRequest): Promise<EmbedResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/embeddings`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model: opts.model, input: req.texts }),
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        throw new AiProviderError(controller.signal.aborted ? 'timeout' : 'server_error');
      }
      clearTimeout(timer);
      if (res.status === 429) throw new AiProviderError('rate_limited', '429');
      if (res.status >= 500) throw new AiProviderError('server_error', String(res.status));
      if (!res.ok) throw new AiProviderError('unknown', `http_${res.status}`);
      const body = (await res.json()) as EmbeddingsResponse;
      const vectors = body.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      if (vectors.length !== req.texts.length) {
        throw new AiProviderError('invalid_output', 'embedding count');
      }
      const tokensIn = body.usage?.prompt_tokens ?? 0;
      return {
        vectors,
        meta: {
          modelId: body.model ?? opts.model,
          modelVersion: '1',
          tokensIn,
          costMicros: costMicros(opts.model, tokensIn, 0),
        },
      };
    },
  };
}
