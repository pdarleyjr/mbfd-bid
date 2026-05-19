'use client';
import type { AdvisoryEnvelope } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';

export function AIForecastBanner({ bidSessionId }: { bidSessionId: string }) {
  const { data } = useQuery<AdvisoryEnvelope | null>({
    queryKey: ['ai-forecast', bidSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/ai/forecast?session_id=${bidSessionId}`, {
        credentials: 'include',
      });
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return r.json() as Promise<AdvisoryEnvelope>;
    },
    refetchInterval: 30_000,
  });
  if (!data) return null;
  const top =
    data.advisory.forecast.warnings.find((w) => w.level === 'critical') ??
    data.advisory.forecast.warnings.find((w) => w.level === 'warn');
  if (!top) return null;
  const tone = top.level === 'critical' ? 'bg-red-700 text-white' : 'bg-amber-100 text-amber-900';
  return (
    <div data-testid="ai-forecast-banner" className={`${tone} px-4 py-2 text-sm`}>
      <strong>{top.level.toUpperCase()}:</strong> {top.text}
    </div>
  );
}
