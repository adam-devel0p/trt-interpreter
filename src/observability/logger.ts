/**
 * Structured, content-free logger.
 *
 * Content-free *by construction*: `LogProps` is a closed whitelist of identifier-, timing- and
 * status-shaped fields. The `Exact<>` constraint on every log method rejects any extra key at
 * the type level — including from a non-literal variable — so passing `user_notes`, `question`,
 * `body` or any other journal field is a compile error, not a code-review catch.
 *
 * Runtime is a second line of defence: unknown keys are dropped, and string values are capped
 * so an ID field cannot be abused as a prose channel.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Dot-namespaced event name, e.g. `jobs.claimed`, `ai.run.failed`. Never free prose. */
export type LogNamespace =
  | 'http'
  | 'auth'
  | 'db'
  | 'jobs'
  | 'ai'
  | 'flags'
  | 'health'
  | 'privacy'
  | 'billing'
  | 'app'
  | 'memory'
  | 'journeys';
export type LogEvent = `${LogNamespace}.${string}`;

/** The complete set of props a log line may carry. Extend deliberately; never add prose fields. */
export interface LogProps {
  requestId?: string;
  userId?: string;
  route?: string;
  method?: string;
  status?: number | string;
  durationMs?: number;
  objectType?: string;
  objectId?: string;
  objectIds?: readonly string[];
  table?: string;
  count?: number;
  task?: string;
  tier?: string;
  modelId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
  costMicros?: number;
  latencyMs?: number;
  attempt?: number;
  attempts?: number;
  errorClass?: string;
  jobId?: string;
  jobKind?: string;
  journeyId?: string;
  state?: string;
  flag?: string;
  enabled?: boolean;
  migration?: string;
}

/** Rejects any key not in LogProps, even when `P` comes from a variable rather than a literal. */
export type Exact<P> = P & Record<Exclude<keyof P, keyof LogProps>, never>;

export interface LogLine extends LogProps {
  level: LogLevel;
  event: LogEvent;
  ts: string;
}

export interface Logger {
  debug<P extends LogProps>(event: LogEvent, props?: Exact<P>): void;
  info<P extends LogProps>(event: LogEvent, props?: Exact<P>): void;
  warn<P extends LogProps>(event: LogEvent, props?: Exact<P>): void;
  error<P extends LogProps>(event: LogEvent, props?: Exact<P>): void;
  /** Returns a child logger with props merged into every line (request/user scoping). */
  child<P extends LogProps>(props: Exact<P>): Logger;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set<keyof LogProps>([
  'requestId',
  'userId',
  'route',
  'method',
  'status',
  'durationMs',
  'objectType',
  'objectId',
  'objectIds',
  'table',
  'count',
  'task',
  'tier',
  'modelId',
  'promptVersion',
  'schemaVersion',
  'tokensIn',
  'tokensOut',
  'costMicros',
  'latencyMs',
  'attempt',
  'attempts',
  'errorClass',
  'jobId',
  'jobKind',
  'journeyId',
  'state',
  'flag',
  'enabled',
  'migration',
]);

const MAX_STRING = 128;
const EVENT_PATTERN = /^[a-z]+\.[a-z0-9_.-]+$/;

/** Runtime whitelist + string cap. Exported for tests. */
export function sanitizeProps(props: Record<string, unknown> | undefined): LogProps {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else if (Array.isArray(value))
      out[key] = value.slice(0, 50).map((v) => String(v).slice(0, MAX_STRING));
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      out[key] = value;
  }
  return out;
}

export type LogSink = (line: LogLine) => void;

const consoleSink: LogSink = (line) => {
  const text = JSON.stringify(line);
  if (line.level === 'error') console.error(text);
  else if (line.level === 'warn') console.warn(text);
  else console.log(text);
};

export function createLogger(sink: LogSink = consoleSink, base: LogProps = {}): Logger {
  const emit = (level: LogLevel, event: LogEvent, props?: LogProps) => {
    if (!EVENT_PATTERN.test(event)) {
      // A malformed event name is a programming error, not a place to smuggle text.
      throw new Error(`Invalid log event name: ${event.slice(0, 40)}`);
    }
    sink({
      ...base,
      ...sanitizeProps(props as Record<string, unknown> | undefined),
      level,
      event,
      ts: new Date().toISOString(),
    });
  };
  return {
    debug: (event, props) => emit('debug', event, props),
    info: (event, props) => emit('info', event, props),
    warn: (event, props) => emit('warn', event, props),
    error: (event, props) => emit('error', event, props),
    child: (props) => createLogger(sink, { ...base, ...sanitizeProps(props) }),
  };
}

/** Process-wide logger. Route handlers should derive a child with requestId/userId. */
export const logger: Logger = createLogger();

/** Stable, content-free classification of an unknown thrown value. */
export function errorClassOf(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
}
