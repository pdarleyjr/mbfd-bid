import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requireAdmin } from '@/lib/require-admin';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MockBanner } from '../../_components/MockBanner';
import { AIAdvisoryPanel } from './_components/AIAdvisoryPanel';
import { AIAskDeepDialog } from './_components/AIAskDeepDialog';
import { AICostPill } from './_components/AICostPill';
import { AIForecastBanner } from './_components/AIForecastBanner';
import { AdminBoard } from './_components/AdminBoard';

export const runtime = 'edge';

interface BoardSnapshot {
  bidSessionId: string;
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  bidOrder: Array<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
  isMock?: boolean;
}

async function loadBoard(
  jwt: string,
): Promise<{ board: BoardSnapshot | null; fetchError: string | null }> {
  const workerBase = getWorkerBase();
  try {
    const res = await fetch(`${workerBase}/api/board?bidSessionId=01HSESS`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { board: null, fetchError: `Worker returned ${res.status}` };
    }
    const board = (await res.json()) as BoardSnapshot;
    return { board, fetchError: null };
  } catch (e) {
    return { board: null, fetchError: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export default async function AdminBidPage() {
  await requireAdmin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) redirect('/login');

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) throw new Error('JWT_SIGNING_KEY not set');
  const claims = await verifyJwt(jwt, signingKey);

  const { board, fetchError } = await loadBoard(jwt);

  if (fetchError !== null || board === null) {
    return (
      <div className="min-h-screen bg-stone-50 p-6">
        <header className="mb-4">
          <h1 className="font-display text-2xl text-stone-900">MBFD 2026 Bid — Admin Console</h1>
        </header>
        <div className="rounded-lg border border-amber-600 bg-amber-50 p-4 text-sm text-amber-900">
          Could not load the bid board: {fetchError ?? 'no data'}.{' '}
          <span className="text-amber-800">
            Check the Worker logs and JWT validity, then reload this page.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <MockBanner isMock={board.isMock === true} sessionId={board.bidSessionId} />
      <header
        data-testid="bid-board-header"
        className="border-b border-stone-200 bg-white px-6 py-4"
      >
        <div className="flex items-baseline gap-3 font-display text-2xl text-stone-900">
          <span>MBFD 2026 Bid — Admin Console</span>
          <span className="text-sm font-medium text-stone-600">Phase: {board.currentPhase}</span>
          <AICostPill bidSessionId={board.bidSessionId} />
        </div>
        <p className="mt-2 text-sm tabular-nums text-stone-700">
          Active bidder: <span className="font-bold">{board.currentBidderId ?? '—'}</span>
        </p>
      </header>
      <AIForecastBanner bidSessionId={board.bidSessionId} />
      <div className="flex">
        <div className="flex-1">
          <AdminBoard
            bidSessionId={board.bidSessionId}
            initialSeq={board.lastSeq}
            meMemberId={claims.sub}
            jwt={jwt}
            initialFills={board.fills}
          />
        </div>
        <div className="flex flex-col">
          <AIAdvisoryPanel bidSessionId={board.bidSessionId} turnTimerSeconds={180} />
          <div className="border-l border-stone-200 bg-white p-4 w-[360px]">
            <AIAskDeepDialog bidSessionId={board.bidSessionId} />
          </div>
        </div>
      </div>
    </div>
  );
}
