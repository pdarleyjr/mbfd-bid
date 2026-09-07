'use client';
import { useRef } from 'react';

/** Keep the request identity and generated IDs until an accepted receipt arrives. */
export function useRetainedMutation<T>(prefix: string) {
  const pending = useRef<{ fingerprint: string; key: string; payload: T } | null>(null);
  return {
    prepare(fingerprint: string, createPayload: () => T) {
      if (pending.current?.fingerprint !== fingerprint) {
        pending.current = {
          fingerprint,
          key: `${prefix}-${crypto.randomUUID()}`,
          payload: createPayload(),
        };
      }
      return pending.current;
    },
    accepted(key: string) {
      if (pending.current?.key === key) pending.current = null;
    },
  };
}
