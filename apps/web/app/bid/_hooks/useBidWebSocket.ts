'use client';
import { OPERATOR_AUTH_REFRESHED } from '@/lib/operator-step-up';
import {
  type BidEventEnvelope,
  BidEventEnvelopeSchema,
  type SyntheticSpecialtyStateSignal,
  SyntheticSpecialtyStateSignalSchema,
} from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand';
import type { BidStoreState } from './useBidStore';

const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
const OPEN_READY_STATE = 1;

export type BidWebSocketStatus = 'connecting' | 'open' | 'closed';

/**
 * Build the WebSocket URL.
 *
 * The Pages site has no `/api/ws/...` route — the WebSocket endpoint lives on
 * the Worker. The server-rendered page passes `wsBase` so the client connects
 * directly to it. Authentication uses a short-lived opaque ticket in the
 * WebSocket subprotocol rather than putting the access JWT in the URL.
 */
function buildWsUrl(wsBase: string | undefined, bidSessionId: string): string {
  const httpBase = wsBase ?? (typeof window === 'undefined' ? '' : window.location.origin);
  const wsHttp = httpBase.startsWith('http')
    ? httpBase.replace(/^http/, 'ws')
    : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${typeof window !== 'undefined' ? window.location.host : ''}`;
  return `${wsHttp.replace(/\/$/, '')}/api/ws/session/${encodeURIComponent(bidSessionId)}`;
}

function ticketFromResponseBody(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const ticket = (body as Record<string, unknown>).ticket;
  return typeof ticket === 'string' && ticket.length > 0 ? ticket : null;
}

async function requestWebSocketTicket(bidSessionId: string): Promise<string> {
  const response = await fetch('/api/auth/ws-ticket', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: bidSessionId }),
  });
  const body: unknown = await response.json().catch(() => null);
  const ticket = ticketFromResponseBody(body);
  if (!response.ok || ticket === null) {
    throw new Error('websocket_ticket_unavailable');
  }
  return ticket;
}

export function useBidWebSocket(
  store: StoreApi<BidStoreState> | null,
  opts: {
    bidSessionId: string;
    wsBase?: string | undefined;
    enabled?: boolean | undefined;
    onSyntheticSpecialtyState?: ((signal: SyntheticSpecialtyStateSignal) => void) | undefined;
  },
): { status: BidWebSocketStatus; send: (data: object) => boolean } {
  const [status, setStatus] = useState<BidWebSocketStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    // The specialty workspace can use the same authenticated transport without
    // a normal Bid store. Tests and server-like renderers may not provide a
    // browser WebSocket implementation, which is a closed transport state—not
    // a reason to issue a ticket request or begin reconnect retries.
    if (
      opts.enabled === false ||
      opts.bidSessionId.trim().length === 0 ||
      typeof WebSocket === 'undefined'
    ) {
      setStatus('closed');
      return () => {
        cancelled = true;
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
      setStatus('closed');
      const backoff =
        RECONNECT_BACKOFF_MS[Math.min(attemptRef.current, RECONNECT_BACKOFF_MS.length - 1)] ?? 8000;
      attemptRef.current += 1;
      reconnectTimer = setTimeout(() => {
        void connect();
      }, backoff);
    }

    async function connect() {
      if (cancelled) return;
      const connectionGeneration = ++generation;
      const isCurrent = () => !cancelled && generation === connectionGeneration;
      setStatus('connecting');
      let ticket: string;
      try {
        ticket = await requestWebSocketTicket(opts.bidSessionId);
      } catch {
        if (isCurrent()) scheduleReconnect();
        return;
      }
      if (!isCurrent()) return;

      const ws = new WebSocket(buildWsUrl(opts.wsBase, opts.bidSessionId), ['mbfd-bid-v1', ticket]);
      wsRef.current = ws;
      ws.onopen = () => {
        if (!isCurrent()) return;
        attemptRef.current = 0;
        setStatus('open');
        ws.send(
          JSON.stringify({
            type: 'hello',
            lastSeq: store?.getState().lastSeq ?? 0,
          }),
        );
      };
      ws.onmessage = (ev) => {
        if (!isCurrent()) return;
        try {
          const raw = JSON.parse(String(ev.data));
          const bidEnvelope = BidEventEnvelopeSchema.safeParse(raw);
          if (bidEnvelope.success) {
            const envelope = bidEnvelope.data as BidEventEnvelope;
            store?.getState().applyEvent(envelope);
            return;
          }
          const specialtySignal = SyntheticSpecialtyStateSignalSchema.safeParse(raw);
          if (specialtySignal.success && specialtySignal.data.bidSessionId === opts.bidSessionId) {
            opts.onSyntheticSpecialtyState?.(specialtySignal.data);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!isCurrent()) return;
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    }
    function reconnectAfterAuthentication() {
      if (cancelled) return;
      generation += 1;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      attemptRef.current = 0;
      const previous = wsRef.current;
      wsRef.current = null;
      previous?.close();
      void connect();
    }
    window.addEventListener(OPERATOR_AUTH_REFRESHED, reconnectAfterAuthentication);
    void connect();
    return () => {
      cancelled = true;
      generation += 1;
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, reconnectAfterAuthentication);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [opts.bidSessionId, opts.enabled, opts.onSyntheticSpecialtyState, opts.wsBase, store]);

  return {
    status,
    send: (data) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== OPEN_READY_STATE) return false;
      try {
        ws.send(JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
  };
}
