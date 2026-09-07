import { Skeleton } from '@/components/ui/skeleton';
export default function MemberDetailLoading() {
  return (
    <div>
      <Skeleton className="mb-6 h-4 w-32 animate-pulse rounded bg-muted" />
      <Skeleton className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <Skeleton className="mt-1 h-4 w-48 animate-pulse rounded bg-muted" />
      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-24 animate-pulse rounded bg-muted" />
            <Skeleton className="mt-2 h-5 w-32 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </dl>
    </div>
  );
}
