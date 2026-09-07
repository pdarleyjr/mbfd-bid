import Link from 'next/link';

export default function MemberNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-6xl font-bold text-foreground">404</p>
      <h1 className="mt-4 font-heading text-2xl text-foreground">Member not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The requested member record does not exist.
      </p>
      <Link
        href={'/admin/members' as const}
        className="mt-6 flex min-h-[44px] items-center rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        Back to members
      </Link>
    </div>
  );
}
