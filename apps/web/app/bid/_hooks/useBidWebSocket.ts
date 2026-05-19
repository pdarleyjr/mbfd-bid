'use client';
import { type BidEventEnvelope, BidEventEnvelopeSchema } from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand';
import type { BidStoreState } from './useBidStore';

const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export function useBidWebSocket(
  store: StoreApi<BidStoreState>,
  opts: { bidSessionId: string; jwt: string },
): { status: 'connecting' | 'open' | 'closed'; send: (data: object) => void } {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    function connect() {
      if (cancelled) return;
      const base = typeof window === 'undefined' ? '' : window.location.host;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${base}/api/ws/session/${opts.bidSessionId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');
      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus('open');
        ws.send(
          JSON.stringify({
            type: 'hello',
            jwt: opts.jwt,
            lastSeq: store.getState().lastSeq,
          }),
        );
      };
      ws.onmessage = (ev) => {
        try {
          const raw = JSON.parse(String(ev.data));
          const parsed = BidEventEnvelopeSchema.safeParse(raw);
          if (!parsed.success) return;
          store.getState().applyEvent(parsed.data as BidEventEnvelope);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setStatus('closed');
        const backoff =
          RECONNECT_BACKOFF_MS[Math.min(attemptRef.current, RECONNECT_BACKOFF_MS.length - 1)] ??
          8000;
        attemptRef.current += 1;
        setTimeout(connect, backoff);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [opts.bidSessionId, opts.jwt, store]);

  return {
    status,
    send: (data) => wsRef.current?.send(JSON.stringify(data)),
  };
}
