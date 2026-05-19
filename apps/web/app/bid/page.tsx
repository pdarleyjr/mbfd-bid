import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requirePin } from '@/lib/require-pin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BidBoard } from './_components/BidBoard';
import { BoardHeader } from './_components/BoardHeader';
import { PositionGrid } from './_components/PositionGrid';

export const runtime = 'edge';

interface BoardSnapshot {
  bidSessionId: string;
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  bidOrder: Array<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
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

export default async function BidPage() {
  await requirePin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) redirect('/login');

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) throw new Error('JWT_SIGNING_KEY not set');
  const claims = await verifyJwt(jwt, signingKey);

  const board = await loadBoard(jwt);

  return (
    <main className="min-h-screen bg-stone-50">
      <BoardHeader
        currentBidderId={board.currentBidderId}
        currentPhase={board.currentPhase}
        meMemberId={claims.sub}
      />
      <PositionGrid fills={board.fills} />
      <BidBoard
        bidSessionId={board.bidSessionId}
        initialSeq={board.lastSeq}
        meMemberId={claims.sub}
        jwt={jwt}
      />
    </main>
  );
}
