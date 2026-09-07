'use client';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

/** Dated staffing and annual preparation never invalidate completed award evidence. */
export function invalidateWorkingBidBoards(
  client: QueryClient,
  views: ('current' | 'upcoming')[] = ['current', 'upcoming'],
) {
  return Promise.all(
    views.map((view) => client.invalidateQueries({ queryKey: ['admin', 'bid-board', view] })),
  );
}

export function usePersonnelProjectionRefresh() {
  const client = useQueryClient();
  const router = useRouter();
  return async (kind: 'personnel' | 'qualification' = 'personnel') => {
    const keys =
      kind === 'personnel'
        ? ['members', 'current-roster', 'organization', 'annual-plan', 'service-evidence']
        : ['credentials', 'annual-plan'];
    await Promise.all([
      ...keys.map((key) => client.invalidateQueries({ queryKey: ['admin', key] })),
      invalidateWorkingBidBoards(
        client,
        kind === 'personnel' ? ['current', 'upcoming'] : ['upcoming'],
      ),
    ]);
    router.refresh();
  };
}
