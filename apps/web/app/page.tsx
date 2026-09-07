import { BrandHeader } from '@/components/BrandHeader';
import { PinForm } from '@/components/PinForm';
import { PIN_COOKIE_NAME } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const c = await cookies();
  if (c.get(PIN_COOKIE_NAME)?.value === 'ok') {
    redirect('/login');
  }
  return (
    <div className="min-h-screen bg-background">
      <BrandHeader subtitle="Authorized access only" />
      <main className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md flex-col justify-center px-4 py-16">
        <header className="mb-8">
          <h2 className="font-heading text-3xl text-foreground">Enter access PIN</h2>
          <p className="mt-2 text-muted-foreground">
            Use the PIN provided for MBFD Annual Bid access.
          </p>
        </header>
        <PinForm />
      </main>
    </div>
  );
}
