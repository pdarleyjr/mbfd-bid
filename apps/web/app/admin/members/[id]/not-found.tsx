import Link from 'next/link';

export default function MemberNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-6xl font-bold text-slate-700">404</p>
      <h1 className="mt-4 font-heading text-2xl text-white">Member not found</h1>
      <p className="mt-2 text-sm text-slate-400">The requested member record does not exist.</p>
      <Link
        href={'/admin/members' as const}
        className="mt-6 flex min-h-[44px] items-center rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
      >
        Back to members
      </Link>
    </div>
  );
}
