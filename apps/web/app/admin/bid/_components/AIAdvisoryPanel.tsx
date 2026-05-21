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
        const body = (await r.json().catch(() => ({}))) as { reason?: string; detail?: string };
        throw new Error(body.reason ?? body.detail ?? 'disabled');
      }
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`http_${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
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
    const msg = error instanceof Error ? error.message : String(error);
    // Translate the common gate reasons into something the chief can act on
    // instead of the bare slug. Everything else falls through as-is so the
    // network panel still shows the underlying HTTP error.
    const friendly =
      msg === 'feature_flag_off'
        ? 'AI advisor is disabled (feature flag is off). Toggle it in /admin/settings to enable.'
        : msg === 'budget_exceeded'
          ? 'AI advisor is paused — the session has exceeded its spend cap.'
          : msg.startsWith('http_503')
            ? 'AI advisor is temporarily unavailable. Check ANTHROPIC_API_KEY + AI Gateway config on the Worker.'
            : msg.startsWith('http_5')
              ? `AI advisor server error: ${msg}`
              : `AI advisor unavailable: ${msg}`;
    return (
      <aside data-testid="ai-panel-error" className="p-4 text-sm text-stone-700">
        <h2 className="mb-1 font-semibold text-stone-900">AI Advisor</h2>
        <p>{friendly}</p>
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
