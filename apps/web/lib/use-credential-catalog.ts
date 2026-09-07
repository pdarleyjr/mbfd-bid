'use client';
import { useQuery } from '@tanstack/react-query';
export function useCredentialCatalog() {
  return useQuery({
    queryKey: ['admin', 'credentials'],
    staleTime: 30_000,
    queryFn: async () => {
      const rows: { id: number; name: string; policyName?: string; retiredOn?: string | null }[] =
        [];
      let total = 1;
      while (rows.length < total) {
        const response = await fetch(`/api/admin/credentials?limit=500&offset=${rows.length}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Qualification catalog unavailable');
        const result = (await response.json()) as { credentials: typeof rows; total: number };
        if (!result.credentials.length && rows.length < result.total)
          throw new Error('Qualification catalog incomplete');
        rows.push(...result.credentials);
        total = result.total;
      }
      return rows;
    },
  });
}
