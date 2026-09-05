import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { getWorkerBase } from '@/lib/worker-base';
import type { BidAdvisoryBundle } from '@mbfd/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { MockBanner } from '../../_components/MockBanner';
import type { BidderContext } from '../../_components/bid/BidderCard';
import type { MemberLite, PositionMeta } from '../../_components/bid/types';
import { AdminBidShell } from './_components/AdminBidShell';
import type { AnnualOperationsStatusPayload } from './_components/AnnualOperationsStatus';

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
  bidOrderPreview?: boolean;
  isMock?: boolean;
  /** D1 mock-only command revision; intentionally not the bid event sequence. */
  mockControlRevision: number | null;
  sessionStartedAt: number | null;
  turnStartedAtMs?: number;
  turnTimerSeconds?: number;
  /** V3 immutable rule-book position material for this exact session. */
  positions?: PositionMeta[];
  annual?: AnnualOperationsStatusPayload | null;
  advisory?: BidAdvisoryBundle | null;
}

interface ActiveSessionResponse {
  session: { id: string } | null;
}

interface MeResponse {
  memberId: number;
}

async function loadBoard(
  sessionId: string,
): Promise<{ board: BoardSnapshot | null; fetchError: string | null }> {
  try {
    const res = await serverWorkerFetch(`/api/board?bidSessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
      return { board: null, fetchError: `Worker returned ${res.status}` };
    }
    const board = (await res.json()) as BoardSnapshot;
    return { board, fetchError: null };
  } catch (e) {
    return { board: null, fetchError: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function loadActiveSession(): Promise<string | null> {
  const res = await serverWorkerFetch('/api/admin/bid-session/active');
  if (!res.ok) return null;
  const body = (await res.json()) as ActiveSessionResponse;
  return body.session?.id ?? null;
}

async function loadLocalMemberId(): Promise<number | null> {
  const res = await serverWorkerFetch('/api/me');
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<MeResponse>;
  return Number.isSafeInteger(body.memberId) && Number(body.memberId) > 0
    ? Number(body.memberId)
    : null;
}

export default async function AdminBidPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; bidSessionId?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const sessionId = sp.session_id ?? sp.bidSessionId ?? (await loadActiveSession());
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-stone-50 p-6">
        <header className="mb-4">
          <h1 className="font-display text-2xl text-stone-900">MBFD Annual Bid — Admin Console</h1>
        </header>
        <div className="rounded-lg border border-amber-600 bg-amber-50 p-4 text-sm text-amber-900">
          No active bid session is available.
          <Link
            href={'/admin/sessions/new?mock=1' as Route}
            className="ml-2 font-semibold underline"
          >
            Create a mock rehearsal session
          </Link>
        </div>
      </div>
    );
  }

  const { board, fetchError } = await loadBoard(sessionId);
  const localMemberId = await loadLocalMemberId();

  if (fetchError !== null || board === null || localMemberId === null) {
    return (
      <div className="min-h-screen bg-stone-50 p-6">
        <header className="mb-4">
          <h1 className="font-display text-2xl text-stone-900">MBFD Annual Bid — Admin Console</h1>
        </header>
        <div className="rounded-lg border border-amber-600 bg-amber-50 p-4 text-sm text-amber-900">
          Could not load the bid board:{' '}
          {fetchError ??
            (localMemberId === null ? 'exact Bid roster identity unavailable' : 'no data')}
          .{' '}
          <span className="text-amber-800">
            Check the Worker logs and JWT validity, then reload this page.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="bid-board-header" className="min-h-screen bg-stone-50 text-stone-900">
      <MockBanner isMock={board.isMock === true} sessionId={board.bidSessionId} />
      <AdminBidShell
        bidSessionId={board.bidSessionId}
        lastSeq={board.lastSeq}
        currentPhase={board.currentPhase}
        currentBidderId={board.currentBidderId}
        currentBidder={board.currentBidder ?? null}
        onDeck={board.onDeck ?? []}
        bidOrder={board.bidOrder ?? []}
        bidOrderPreview={board.bidOrderPreview === true}
        sessionStartedAt={board.sessionStartedAt}
        turnStartedAtMs={board.turnStartedAtMs ?? 0}
        turnTimerSeconds={board.turnTimerSeconds ?? 180}
        meMemberId={localMemberId}
        initialFills={board.fills}
        members={board.members ?? {}}
        positions={board.positions}
        wsBase={getWorkerBase()}
        isMock={board.isMock === true}
        mockControlRevision={board.mockControlRevision}
        annual={board.annual}
        advisory={board.advisory ?? null}
      />
    </div>
  );
}
