import { BrandHeader } from '@/components/BrandHeader';
import { requireAdmin } from '@/lib/require-admin';
import { AdminLayoutShell } from './_components/AdminLayoutShell';
import { AdminQueryProvider } from './_components/AdminQueryProvider';
import { StepUpProvider } from './_components/StepUpProvider';

export const runtime = 'edge';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Verifies JWT and redirects non-admins to /lobby or /login.
  await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-850 text-slate-50">
      <BrandHeader subtitle="Admin Console" />
      <AdminQueryProvider>
        <StepUpProvider>
          <AdminLayoutShell>{children}</AdminLayoutShell>
        </StepUpProvider>
      </AdminQueryProvider>
    </div>
  );
}
