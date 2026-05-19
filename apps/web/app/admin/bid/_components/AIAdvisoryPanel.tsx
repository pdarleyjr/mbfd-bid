'use client';
import type { AdvisoryEnvelope } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';

interface Props {
  bidSessionId: string;
  turnTimerSeconds: number;
}

export function AIAdvisoryPanel({ bidSessionId, turnTimerSeconds }: Props) {
  const { data, isLoading, error } = useQuery<AdvisoryEnvelope>({
    queryKey: ['ai-advise-current', bidSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/ai/advise-current?session_id=${bidSessionId}`, {
        credentials: 'include',
      });
      if (r.status === 503) {
        const body = (await r.json()) as { reason?: string };
        throw new Error(body.reason ?? 'disabled');
      }
      if (!r.ok) throw new Error(`http_${r.status}`);
      return r.json() as Promise<AdvisoryEnvelope>;
    },
    staleTime: turnTimerSeconds * 1000,
    refetchInterval: turnTimerSeconds * 1000,
  });

  if (isLoading) {
    return (
      <aside data-testid="ai-panel-loading" className="p-4">
        Loading advisory…
      </aside>
    );
  }
  if (error) {
    return (
      <aside data-testid="ai-panel-error" className="p-4 text-stone-500">
        AI advisor unavailable
      </aside>
    );
  }
  if (!data) return null;

  const { advisory, stale } = data;
  return (
    <aside
      className="border-l border-stone-200 bg-white p-4 w-[360px] flex flex-col gap-4"
      aria-label="AI advisory"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">AI Advisor</h2>
        {stale && (
          <span
            data-testid="ai-panel-stale-badge"
            className="text-xs bg-amber-100 text-amber-900 rounded px-2 py-0.5"
          >
            stale
          </span>
        )}
      </header>
      <p data-testid="ai-panel-summary" className="text-sm">
        {advisory.summary}
      </p>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1">
          Recommendations
        </h3>
        <ul className="text-sm space-y-1">
          {advisory.eligible_recommendations.map((r) => (
            <li key={r.position_id} data-testid={`ai-panel-recommendation-${r.position_id}`}>
              <span className="font-mono">{r.position_id}</span> · {r.points}pts — {r.why}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1">
          Likely-want but ineligible
        </h3>
        <ul className="text-sm space-y-1">
          {advisory.ineligible_top_picks.map((r) => (
            <li key={r.position_id} data-testid={`ai-panel-ineligible-${r.position_id}`}>
              <span className="font-mono">{r.position_id}</span> — {r.why_ineligible}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1">
          Forecast
        </h3>
        <ul className="text-sm space-y-1">
          {advisory.forecast.warnings.map((w, i) => {
            const firstPos = w.affected_positions[0];
            const testId = firstPos ? `ai-panel-warning-${firstPos}` : `ai-panel-warning-${i}`;
            const colorClass =
              w.level === 'critical'
                ? 'text-red-700 font-semibold'
                : w.level === 'warn'
                  ? 'text-amber-700'
                  : 'text-stone-600';
            return (
              <li key={`${i}-${w.text}`} data-testid={testId}>
                <span className={colorClass}>{w.text}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
