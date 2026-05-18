import { BrandHeader } from '@/components/BrandHeader';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { type JwtPayload, RANK_LABELS } from '@mbfd/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const runtime = 'edge';

export default async function LobbyPage() {
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) redirect('/login');

  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) throw new Error('missing JWT_SIGNING_KEY');

  let payload: JwtPayload;
  try {
    payload = await verifyJwt(jwt, signingKey);
  } catch {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <BrandHeader subtitle={`Hi, ${payload.first_name} — ${RANK_LABELS[payload.rank]}`} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <h2 className="font-heading text-2xl text-stone-800">Lobby</h2>
        <p className="mt-2 text-stone-600">
          Bid hasn't started yet. This page will become the pre-bid lobby in Plan 04.
        </p>
        <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card label="Employee ID" value={payload.emp} numeric />
          <Card label="Rank" value={RANK_LABELS[payload.rank]} />
          <Card label="Member ID" value={String(payload.sub)} numeric />
          <Card label="Role" value={payload.role} />
        </dl>
      </main>
    </div>
  );
}

function Card({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition duration-base ease-out-quart hover:border-red-200">
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</dt>
      <dd
        className={`mt-1 text-lg font-semibold text-stone-800 ${numeric ? 'font-mono [font-variant-numeric:tabular-nums]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
