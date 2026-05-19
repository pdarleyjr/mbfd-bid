import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requirePin } from '@/lib/require-pin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BidBoard } from './_components/BidBoard';
import { BoardHeader } from './_components/BoardHeader';

export const runtime = 'edge';

interface BoardSnapshot {
  bidSessionId: string;
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  bidOrder: Array<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
}

interface EligibilityResponse {
  memberId: number;
  positions: Array<{ positionId: string; eligible: boolean }>;
}

async function loadBoard(jwt: string): Promise<BoardSnapshot> {
  const workerBase = cfEnv('WORKER_BASE_URL') ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/api/board?bidSessionId=01HSESS`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Board fetch failed: ${res.status}`);
  return (await res.json()) as BoardSnapshot;
}

async function loadEligibility(jwt: string): Promise<string[]> {
  const workerBase = cfEnv('WORKER_BASE_URL') ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/api/me/eligibility`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as EligibilityResponse;
  return body.positions.filter((p) => p.eligible).map((p) => p.positionId);
}

export default async function BidPage() {
  await requirePin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) redirect('/login');

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) throw new Error('JWT_SIGNING_KEY not set');
  const claims = await verifyJwt(jwt, signingKey);

  const [board, eligiblePositionIds] = await Promise.all([loadBoard(jwt), loadEligibility(jwt)]);

  return (
    <main className="min-h-screen bg-stone-50">
      <BoardHeader
        currentBidderId={board.currentBidderId}
        currentPhase={board.currentPhase}
        meMemberId={claims.sub}
      />
      <BidBoard
        bidSessionId={board.bidSessionId}
        initialSeq={board.lastSeq}
        meMemberId={claims.sub}
        jwt={jwt}
        initialFills={board.fills}
        eligiblePositionIds={eligiblePositionIds}
      />
    </main>
  );
}
