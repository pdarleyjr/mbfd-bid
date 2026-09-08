import { AnnualRequestError } from '../annual-plan/annual-plan-client';

const retryDelays = [5000, 10000, 20000, 40000, 60000];

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Retry only explicit temporary failures, never a denied identity or stale review. */
export async function retryImportGroup<T>(
  send: () => Promise<T>,
  signal: AbortSignal,
  onRetry: (seconds: number) => void,
  wait = waitForRetry,
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) return null;
    try {
      return await send();
    } catch (error) {
      const delay = retryDelays[attempt];
      const temporary =
        error instanceof AnnualRequestError &&
        (error.status === 429 ||
          (error.status === 503 && error.code === 'authorization_unavailable'));
      if (!temporary || delay === undefined) throw error;
      onRetry(delay / 1000);
      await wait(delay, signal);
    }
  }
}
