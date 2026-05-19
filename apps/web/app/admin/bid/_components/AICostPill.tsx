'use client';
import { useQuery } from '@tanstack/react-query';

interface CostResponse {
  cost_cents: number;
  cap_cents: number;
}

export function AICostPill({ bidSessionId }: { bidSessionId: string }) {
  const { data } = useQuery<CostResponse>({
    queryKey: ['ai-cost', bidSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/ai/cost?session_id=${bidSessionId}`, {
        credentials: 'include',
      });
      return r.json() as Promise<CostResponse>;
    },
    refetchInterval: 30_000,
  });
  if (!data) return null;
  const pct = data.cap_cents ? Math.round((data.cost_cents / data.cap_cents) * 100) : 0;
  const tone =
    pct >= 90
      ? 'bg-red-700 text-white'
      : pct >= 60
        ? 'bg-amber-100 text-amber-900'
        : 'bg-stone-100 text-stone-700';
  return (
    <span data-testid="ai-cost-pill" className={`text-xs rounded-full px-2 py-0.5 ${tone}`}>
      AI ${(data.cost_cents / 100).toFixed(2)} / ${(data.cap_cents / 100).toFixed(2)}
    </span>
  );
}
