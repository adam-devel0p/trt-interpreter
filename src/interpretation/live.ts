/**
 * In-process registry of interpretation runs in flight, so a client that reconnects to the same
 * instance mid-stream gets the buffered events replayed and then the live tail (§13: partial
 * output preserved on disconnect and resumable). Persistence is the source of truth; this is
 * only the fast path. Entries expire shortly after the run ends.
 */
import type { ServiceEvent } from './events';

interface LiveRun {
  readingId: string;
  events: ServiceEvent[];
  done: boolean;
  listeners: Set<(e: ServiceEvent) => void>;
  abort: AbortController;
  expiresAt: number | null;
}

const RETAIN_MS = 2 * 60 * 1000;
const runs = new Map<string, LiveRun>();

function sweep(now = Date.now()) {
  for (const [id, r] of runs) if (r.expiresAt !== null && r.expiresAt <= now) runs.delete(id);
}

export function registerRun(interpretationId: string, readingId: string): AbortController {
  sweep();
  const abort = new AbortController();
  runs.set(interpretationId, {
    readingId,
    events: [],
    done: false,
    listeners: new Set(),
    abort,
    expiresAt: null,
  });
  return abort;
}

export function publish(interpretationId: string, event: ServiceEvent): void {
  const r = runs.get(interpretationId);
  if (!r) return;
  r.events.push(event);
  for (const l of r.listeners) l(event);
  if (event.type === 'complete' || event.type === 'failed') {
    r.done = true;
    r.expiresAt = Date.now() + RETAIN_MS;
  }
}

export function findLiveForReading(readingId: string): string | null {
  sweep();
  for (const [id, r] of runs) if (r.readingId === readingId && !r.done) return id;
  return null;
}

export function cancelRun(interpretationId: string): boolean {
  const r = runs.get(interpretationId);
  if (!r || r.done) return false;
  r.abort.abort();
  return true;
}

/** Replay what has happened so far, then follow live until the run ends. */
export async function* subscribe(interpretationId: string): AsyncIterable<ServiceEvent> {
  const r = runs.get(interpretationId);
  if (!r) return;
  let i = 0;
  const queue: ServiceEvent[] = [];
  let wake: (() => void) | null = null;
  const listener = (e: ServiceEvent) => {
    queue.push(e);
    wake?.();
  };
  r.listeners.add(listener);
  try {
    for (; i < r.events.length; i++) yield r.events[i]!;
    while (!r.done || queue.length) {
      if (queue.length === 0) {
        if (r.done) break;
        await new Promise<void>((res) => {
          wake = res;
        });
        wake = null;
      }
      const e = queue.shift();
      if (e) yield e;
    }
  } finally {
    r.listeners.delete(listener);
  }
}

/** Test-only. */
export function resetLiveForTests(): void {
  runs.clear();
}
