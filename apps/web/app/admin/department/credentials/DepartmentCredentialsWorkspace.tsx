'use client';

import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { CredentialsCatalogWorkspace } from '../../credentials/CredentialsCatalogWorkspace';
import { readCredentialCatalog } from '../people/people-api';

export function DepartmentCredentialsWorkspace() {
  const catalog = useQuery({
    queryKey: ['admin', 'credentials'],
    queryFn: ({ signal }) => readCredentialCatalog(signal),
    staleTime: 30_000,
  });
  if (catalog.isPending)
    return <output className="block p-5 text-sm">Loading credential definitions…</output>;
  if (catalog.isError)
    return (
      <div
        role="alert"
        className="space-y-3 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm"
      >
        <p>{catalog.error.message}</p>
        <Button
          variant="secondary"
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          Retry credential definitions
        </Button>
      </div>
    );
  return <CredentialsCatalogWorkspace initialCredentials={catalog.data} departmentMode />;
}
