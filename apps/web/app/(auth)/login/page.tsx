import { BrandHeader } from '@/components/BrandHeader';
import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { requirePin } from '@/lib/require-pin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  await requirePin();
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (jwt && signingKey) {
    const claims = await verifyJwt(jwt, signingKey).catch(() => null);
    if (claims?.role === 'admin') redirect('/admin');
    if (claims?.role === 'member') redirect('/lobby');
  }
  return (
    <div className="min-h-screen bg-stone-50">
      <BrandHeader subtitle="Authorized personnel only" />
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <h2 className="font-heading text-2xl text-stone-800">Sign in</h2>
        <p className="mt-1 text-sm text-stone-600">Use your employee portal credentials.</p>
        <div className="mt-8">
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
