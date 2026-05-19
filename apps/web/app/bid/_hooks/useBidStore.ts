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
          const fills: Record<string, Fill> = {};
          for (const f of p.fills) {
            fills[f.positionId] = { memberId: f.memberId, ordinal: f.ordinal, bidId: '' };
          }
          set({ fills, currentBidderId: p.currentBidderId, lastSeq: p.seq });
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
