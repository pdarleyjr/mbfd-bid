import { BrandHeader } from '@/components/BrandHeader';
import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requirePin } from '@/lib/require-pin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await requirePin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (jwt && signingKey) {
    const claims = await verifyJwt(jwt, signingKey).catch(() => null);
    if (claims?.role === 'admin') redirect('/admin');
    if (claims?.role === 'member') redirect('/lobby');
  }

  const { error } = await searchParams;
  if (!error) redirect('/api/auth/start');

  return (
    <div className="min-h-screen bg-stone-50">
      <BrandHeader subtitle="Authorized personnel only" />
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <h2 className="font-heading text-2xl text-stone-800">Hub sign-in required</h2>
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error === 'access_denied'
            ? 'Your Hub account is not eligible for Bid.'
            : 'Bid could not complete Hub authentication. Please try again.'}
        </p>
        <a
          href="/api/auth/start"
          className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-600"
        >
          Continue with MBFD Hub
        </a>
      </main>
    </div>
  );
}
