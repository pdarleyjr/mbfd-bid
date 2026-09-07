import { requireAdmin } from '@/lib/require-admin';
import { AdminLayoutShell } from './_components/AdminLayoutShell';
import { AdminQueryProvider } from './_components/AdminQueryProvider';
import { StepUpProvider } from './_components/StepUpProvider';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Verifies JWT and redirects non-admins to /lobby or /login.
  const claims = await requireAdmin();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminQueryProvider key={`${claims.sub}:${claims.member_id}:${claims.security_version}`}>
        <StepUpProvider>
          <AdminLayoutShell userName={`${claims.first_name} ${claims.last_name}`}>
            {children}
          </AdminLayoutShell>
        </StepUpProvider>
      </AdminQueryProvider>
    </div>
  );
}
