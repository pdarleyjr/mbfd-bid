import { BrandHeader } from '@/components/BrandHeader';
import { cfEnv } from '@/lib/cf-env';
import { redirect } from 'next/navigation';
import { AdminBootstrapForm } from './AdminBootstrapForm';

export const dynamic = 'force-dynamic';

/**
 * This route exists only to recover an intentionally unconfigured staging
 * member-PIN record. It is not a production admin-login surface.
 */
export default function AdminBootstrapPage() {
  if (cfEnv('ENV') !== 'staging') redirect('/');

  return (
    <div className="min-h-screen bg-stone-50">
      <BrandHeader subtitle="Staging PIN setup" />
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <h1 className="font-heading text-2xl text-stone-800">Initialize member access</h1>
        <p className="mt-1 text-sm text-stone-600">
          Use the separate staging admin account to configure the member PIN. This route is
          unavailable outside staging.
        </p>
        <AdminBootstrapForm />
      </main>
    </div>
  );
}
