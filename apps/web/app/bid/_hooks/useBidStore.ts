import type { BidEventEnvelope } from '@mbfd/shared';
import { type StoreApi, createStore } from 'zustand';

interface Fill {
  memberId: number;
  ordinal: number;
  bidId: string;
}

export interface BidStoreState {
  bidSessionId: string;
  meMemberId: number;
  lastSeq: number;
  currentBidderId: number | null;
  fills: Record<string, Fill>;
  pendingMine: Record<string, string>; // positionId -> idempotencyKey
  lastError: { code: string; message: string } | null;
  applyEvent(env: BidEventEnvelope): void;
  markPendingMine(positionId: string, idempotencyKey: string): void;
  clearError(): void;
}

export function createBidStore(init: {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
}): StoreApi<BidStoreState> {
  return createStore<BidStoreState>((set, get) => ({
    bidSessionId: init.bidSessionId,
    meMemberId: init.meMemberId,
    lastSeq: init.initialSeq,
    currentBidderId: null,
    fills: {},
    pendingMine: {},
    lastError: null,
    markPendingMine(positionId, idempotencyKey) {
      set((s) => ({ pendingMine: { ...s.pendingMine, [positionId]: idempotencyKey } }));
    },
    clearError() {
      set({ lastError: null });
    },
    applyEvent(env) {
      const st = get();
      if (env.seq <= st.lastSeq && env.type !== 'state_snapshot') return;
      switch (env.type) {
        case 'state_snapshot': {
          const p = env.payload as {
            fills: Array<{ positionId: string; memberId: number; ordinal: number }>;
            currentBidderId: number | null;
            seq: number;
          };
          // Merge incoming snapshot on top of the local fills the page was
          // hydrated with. The DO's snapshot only contains picks it routed
          // through itself; auto-bid / admin manual-pick / bid-for-member
          // commit straight to D1 without ever touching the DO, so the DO
          // snapshot can ship `fills: []` even when D1 has real picks. The
          // page was rendered with `initialFills` from /api/board which
          // merges D1 into the response — keep those, only overwrite the
          // positions the DO actually has an opinion on.
          set((s) => {
            const merged: Record<string, Fill> = { ...s.fills };
            for (const f of p.fills) {
              merged[f.positionId] = { memberId: f.memberId, ordinal: f.ordinal, bidId: '' };
            }
            return {
              fills: merged,
              // Same logic for currentBidderId: only trust the snapshot when
              // it's non-null. If the DO never advanced and says null but
              // our local state (sourced from D1 via SSR) knows the bidder,
              // keep what we have.
              currentBidderId: p.currentBidderId ?? s.currentBidderId,
              lastSeq: p.seq,
            };
          });
          break;
        }
        case 'pick_made': {
          const p = env.payload as {
            positionId: string;
            memberId: number;
            ordinal: number;
            bidId: string;
            nextBidderId: number | null;
            idempotencyKey: string;
          };
          set((s) => {
            const pending = { ...s.pendingMine };
            // Clear any pending entry for this position
            delete pending[p.positionId];
            return {
              fills: {
                ...s.fills,
                [p.positionId]: { memberId: p.memberId, ordinal: p.ordinal, bidId: p.bidId },
              },
              currentBidderId: p.nextBidderId,
              pendingMine: pending,
              lastSeq: env.seq,
            };
          });
          break;
        }
        case 'pick_rejected': {
          const p = env.payload as { idempotencyKey: string; code: string; message: string };
          set((s) => {
            const pending = { ...s.pendingMine };
            for (const [pos, k] of Object.entries(pending)) {
              if (k === p.idempotencyKey) delete pending[pos];
            }
            return {
              pendingMine: pending,
              lastError: { code: p.code, message: p.message },
              lastSeq: env.seq,
            };
          });
          break;
        }
        case 'skip':
        case 'forced_pick':
        case 'freeze':
          set({ lastSeq: env.seq });
          break;
        default:
          break;
      }
    },
  }));
}
