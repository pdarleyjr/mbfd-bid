import { BrandHeader } from '@/components/BrandHeader';
import { AdminSideNav } from '@/components/admin/AdminShell';
import { requireAdmin } from '@/lib/require-admin';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Verifies JWT and redirects non-admins to /lobby or /login.
  await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-850 text-slate-50">
      <BrandHeader subtitle="Admin Console" />
      <div className="flex min-h-[calc(100vh-57px)]">
        {/* Sidebar */}
        <aside className="hidden w-52 shrink-0 border-r border-slate-700 md:block">
          <AdminSideNav />
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
