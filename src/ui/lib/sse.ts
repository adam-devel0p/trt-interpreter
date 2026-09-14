/**
 * Minimal SSE frame reader over `fetch` (EventSource cannot POST). Yields `(type, data)` per
 * frame; stops when the caller's signal aborts, cancelling the body so the server sees the
 * disconnect. Shared by the interpretation panel and the Ask composer.
 */
export async function readSse(
  res: Response,
  onEvent: (type: string, data: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let type = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        try {
          onEvent(type, JSON.parse(data));
        } catch {
          /* skip malformed frame */
        }
      }
    }
  }
}
