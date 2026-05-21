'use client';
import type { AdvisoryEnvelope } from '@mbfd/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Props {
  bidSessionId: string;
  turnTimerSeconds: number;
}

/**
 * Self-contained client wrapper — the member /bid page is otherwise entirely
 * server-rendered (zustand store excepted), so we mount a private TanStack
 * Query client just for this panel. Cheap: the panel only renders during
 * the member's own turn, and the polling cadence is the turn-timer.
 */
export function MemberAIAdvisoryPanel(props: Props) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MemberAIAdvisoryBody {...props} />
    </QueryClientProvider>
  );
}

function MemberAIAdvisoryBody({ bidSessionId, turnTimerSeconds }: Props) {
  const { data, isLoading, error } = useQuery<AdvisoryEnvelope>({
    queryKey: ['ai-advise-me', bidSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/ai/advise-me?session_id=${bidSessionId}`, {
        credentials: 'include',
      });
      if (r.status === 503) {
        const body = (await r.json()) as { reason?: string };
        throw new Error(body.reason ?? 'disabled');
      }
      if (r.status === 403) throw new Error('not_your_turn');
      if (!r.ok) throw new Error(`http_${r.status}`);
      return r.json() as Promise<AdvisoryEnvelope>;
    },
    staleTime: turnTimerSeconds * 1000,
    refetchInterval: turnTimerSeconds * 1000,
  });

  if (isLoading) {
    return (
      <section
        data-testid="member-ai-loading"
        className="border-y border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        Loading advisory for your turn…
      </section>
    );
  }
  if (error) {
    return (
      <section
        data-testid="member-ai-error"
        className="border-y border-stone-200 bg-stone-50 p-4 text-sm text-stone-500"
      >
        AI advisor unavailable. Pick from the board below.
      </section>
    );
  }
  if (!data) return null;

  const { advisory, stale } = data;
  return (
    <section
      aria-label="AI advisory"
      data-testid="member-ai-panel"
      className="border-y border-red-700 bg-red-50 px-6 py-4"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-red-700">AI suggestion for you</h2>
        {stale && (
          <span
            data-testid="member-ai-stale-badge"
            className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
          >
            stale
          </span>
        )}
      </header>
      <p data-testid="member-ai-summary" className="text-sm text-stone-800">
        {advisory.summary}
      </p>
      {advisory.eligible_recommendations.length > 0 && (
        <section className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-600">
            Top picks
          </h3>
          <ul className="space-y-1 text-sm">
            {advisory.eligible_recommendations.map((r) => (
              <li key={r.position_id} data-testid={`member-ai-recommendation-${r.position_id}`}>
                <span className="font-mono">{r.position_id}</span> · {r.points}pts — {r.why}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-3 text-xs text-stone-500">
        Advisory only — pick from the board below. The board is the source of truth.
      </p>
    </section>
  );
}
