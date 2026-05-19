/**
 * Tiny SSE consumer for /api/admin/ai/advise-deep (Plan 06 Task 16).
 * Yields { type: 'token', text } as data arrives and { type: 'done' } on
 * the `event: done` line. Caller can pass an AbortSignal to cancel.
 */
export interface SseToken {
  type: 'token';
  text: string;
}
export interface SseDone {
  type: 'done';
}
export interface SseError {
  type: 'error';
  message: string;
}
export type SseEvent = SseToken | SseDone | SseError;

export interface DeepStreamInput {
  sessionId: string;
  question: string;
  signal?: AbortSignal;
}

export async function* streamAdviseDeep(input: DeepStreamInput): AsyncGenerator<SseEvent> {
  const fetchInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ session_id: input.sessionId, question: input.question }),
  };
  if (input.signal !== undefined) fetchInit.signal = input.signal;
  const res = await fetch('/api/admin/ai/advise-deep', fetchInit);
  if (!res.ok) {
    yield { type: 'error', message: `http_${res.status}` };
    return;
  }
  if (!res.body) {
    yield { type: 'error', message: 'no_body' };
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // SSE frames are separated by blank lines (\n\n)
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
      }
      if (event === 'done') {
        yield { type: 'done' };
        return;
      }
      if (event === 'error') {
        yield { type: 'error', message: data || 'stream_error' };
        return;
      }
      yield { type: 'token', text: data };
      idx = buf.indexOf('\n\n');
    }
  }
  yield { type: 'done' };
}
