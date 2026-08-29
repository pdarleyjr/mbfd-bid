import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requirePin } from '@/lib/require-pin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MockBanner } from '../_components/MockBanner';
import type { BidderContext } from '../_components/bid/BidderCard';
import { OnDeckQueue } from '../_components/bid/OnDeckQueue';
import type { MemberLite, PositionMeta } from '../_components/bid/types';
import { BidBoard } from './_components/BidBoard';
import { BoardHeader } from './_components/BoardHeader';

export const dynamic = 'force-dynamic';

interface BoardSnapshot {
  bidSessionId: string;
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  currentBidder: BidderContext | null;
  onDeck: BidderContext[];
  members: Record<string, MemberLite>;
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  bidOrder: Array<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
  /** V3 immutable rule-book position material; absent material remains a
   * fail-closed no-data state in session-bound client components. */
  positions?: PositionMeta[];
  isMock?: boolean;
}

interface EligibilityResponse {
  memberId: number;
  positions: Array<{ positionId: string; eligible: boolean }>;
}

async function loadBoard(
  sessionId?: string,
): Promise<{ board: BoardSnapshot | null; fetchError: string | null }> {
  const qs = sessionId ? `?bidSessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await serverWorkerFetch(`/api/board${qs}`);
  if (!res.ok) return { board: null, fetchError: `Worker returned ${res.status}` };
  const board = (await res.json()) as BoardSnapshot;
  return { board, fetchError: null };
}

async function loadEligibility(sessionId: string): Promise<string[]> {
  const res = await serverWorkerFetch(
    `/api/me/eligibility?bidSessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) return [];
  const body = (await res.json()) as EligibilityResponse;
  return body.positions.filter((p) => p.eligible).map((p) => p.positionId);
}

function BidUnavailable({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-stone-50 p-6">
      <div className="rounded-lg border border-amber-600 bg-amber-50 p-4 text-sm text-amber-900">
        The bid board is not available yet: {message}. Check back when the bid session is active.
      </div>
    </main>
  );
}

export default async function BidPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; bidSessionId?: string }>;
}) {
  await requirePin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) redirect('/login');

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) throw new Error('JWT_SIGNING_KEY not set');
  const claims = await verifyJwt(jwt, signingKey);

  const sp = await searchParams;
  const { board, fetchError } = await loadBoard(sp.session_id ?? sp.bidSessionId);
  if (!board) return <BidUnavailable message={fetchError ?? 'no active session'} />;
  const eligiblePositionIds = await loadEligibility(board.bidSessionId);

  return (
    <main className="min-h-screen bg-stone-50">
      <MockBanner isMock={board.isMock === true} sessionId={board.bidSessionId} />
      <BoardHeader
        currentBidderId={board.currentBidderId}
        currentBidder={board.currentBidder ?? null}
        currentPhase={board.currentPhase}
        meMemberId={claims.sub}
      />
      <OnDeckQueue onDeck={board.onDeck ?? []} meMemberId={claims.sub} />
      <BidBoard
        bidSessionId={board.bidSessionId}
        initialSeq={board.lastSeq}
        meMemberId={claims.sub}
        initialFills={board.fills}
        eligiblePositionIds={eligiblePositionIds}
        members={board.members ?? {}}
        positions={board.positions}
        wsBase={getWorkerBase()}
      />
    </main>
  );
}
