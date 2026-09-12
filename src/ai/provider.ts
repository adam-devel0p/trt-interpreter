import type {
  EmbedRequest,
  EmbedResult,
  ObjectRequest,
  ObjectResult,
  ProviderErrorClass,
  ResolvedCall,
  StreamChunk,
  StreamRequest,
} from './types';

export type * from './types';

/**
 * The provider boundary (docs/AI_LAYER.md#provider-interface). Implementations live in
 * ./providers/ and are the only code allowed to import a model SDK.
 *
 * `run.ts` resolves the model and owns retry/repair/timeout/breaker policy; providers make one
 * attempt per call and throw `AiProviderError` with a content-free `errorClass`.
 */
export interface AiProvider {
  readonly id: string;
  generateObject<T>(req: ObjectRequest<T>, call: ResolvedCall): Promise<ObjectResult<T>>;
  generateStream(req: StreamRequest, call: ResolvedCall): AsyncIterable<StreamChunk>;
  /** Throws AiProviderError('unsupported') when the provider has no embedding model. */
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

export class AiProviderError extends Error {
  override readonly name = 'AiProviderError';
  constructor(
    public readonly errorClass: ProviderErrorClass,
    /** Content-free detail: HTTP status, retry-after, validation path — never model text. */
    public readonly detail?: string,
  ) {
    super(`ai provider error: ${errorClass}${detail ? ` (${detail})` : ''}`);
  }
}

export function isProviderError(err: unknown): err is AiProviderError {
  return err instanceof AiProviderError;
}
