import type { InferSelectModel } from 'drizzle-orm';
import type { bidOrder } from '../db/schema.js';

export type BidOrderRow = InferSelectModel<typeof bidOrder>;

export interface BidOrderInputMember {
  id: number;
  bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
  rscSeniority: number;
  rankSeniority: number | null;
}

export interface ComputedBidOrderEntry {
  ordinal: number;
  memberId: number;
  pool: 'OFC' | 'FF';
}

const POOL_ORDER: ReadonlyArray<'OFC' | 'FF'> = ['OFC', 'FF'];

export function computeBidOrder(
  members: ReadonlyArray<BidOrderInputMember>,
): ComputedBidOrderEntry[] {
  const eligible = members.filter((m) => m.bidCategory !== 'EXCLUDED');
  const out: ComputedBidOrderEntry[] = [];
  for (const pool of POOL_ORDER) {
    const poolMembers = eligible
      .filter((m) => m.bidCategory === pool)
      .slice()
      .sort((a, b) => {
        if (a.rscSeniority !== b.rscSeniority) {
          return a.rscSeniority - b.rscSeniority;
        }
        const ar = a.rankSeniority ?? Number.MAX_SAFE_INTEGER;
        const br = b.rankSeniority ?? Number.MAX_SAFE_INTEGER;
        return ar - br;
      });
    for (const m of poolMembers) {
      out.push({ ordinal: out.length + 1, memberId: m.id, pool });
    }
  }
  return out;
}
