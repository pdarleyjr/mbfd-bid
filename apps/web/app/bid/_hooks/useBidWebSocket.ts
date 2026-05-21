'use client';
import { type BidEventEnvelope, BidEventEnvelopeSchema } from '@mbfd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand';
import type { BidStoreState } from './useBidStore';

const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

/**
 * Build the WebSocket URL.
 *
 * The Pages site (staging.bid.mbfdhub.com) has no `/api/ws/...` route — the
 * WebSocket endpoint lives on the Worker (api.staging.bid.mbfdhub.com). The
 * server-rendered page passes `wsBase` so the client connects directly to
 * the Worker. `?token=` carries the JWT because the browser WebSocket API
 * cannot set the Authorization header. The Worker accepts both forms; the
 * query path is the one browsers can actually use.
 */
function buildWsUrl(wsBase: string | undefined, bidSessionId: string, jwt: string): string {
  const httpBase = wsBase ?? (typeof window === 'undefined' ? '' : window.location.origin);
  const wsHttp = httpBase.startsWith('http')
    ? httpBase.replace(/^http/, 'ws')
    : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${typeof window !== 'undefined' ? window.location.host : ''}`;
  return `${wsHttp.replace(/\/$/, '')}/api/ws/session/${encodeURIComponent(bidSessionId)}?token=${encodeURIComponent(jwt)}`;
}

export function useBidWebSocket(
  store: StoreApi<BidStoreState>,
  opts: { bidSessionId: string; jwt: string; wsBase?: string | undefined },
): { status: 'connecting' | 'open' | 'closed'; send: (data: object) => void } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    function connect() {
      if (cancelled) return;
      const url = buildWsUrl(opts.wsBase, opts.bidSessionId, opts.jwt);
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
          const envelope = parsed.data as BidEventEnvelope;
          store.getState().applyEvent(envelope);

          if (
            envelope.type === 'pick_made' ||
            envelope.type === 'forced_pick' ||
            envelope.type === 'skip'
          ) {
            queryClient.invalidateQueries({
              queryKey: ['ai-advise-current', opts.bidSessionId],
            });
          }
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
  }, [opts.bidSessionId, opts.jwt, opts.wsBase, store, queryClient]);

  return {
    status,
    send: (data) => wsRef.current?.send(JSON.stringify(data)),
  };
}
