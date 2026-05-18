import { PinForm } from '@/components/PinForm';
import { PIN_COOKIE_NAME } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const runtime = 'edge';

export default async function Home() {
  const c = await cookies();
  if (c.get(PIN_COOKIE_NAME)?.value === 'ok') {
    redirect('/login');
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <header className="mb-8">
        <h1 className="font-heading text-3xl text-stone-800">MBFD Bid</h1>
        <p className="mt-2 text-stone-600">Authorized access only.</p>
      </header>
      <PinForm />
    </main>
  );
}
