import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { BidPinForm } from './BidPinForm';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PinSetting {
  pin: string;
  updatedAt: string | null;
  updatedBy: string | null;
  isDefault: boolean;
}

async function loadPin(): Promise<{ setting: PinSetting | null; error: string | null }> {
  try {
    const res = await serverWorkerFetch('/api/admin/settings/bid-pin');
    if (!res.ok) return { setting: null, error: `worker returned ${res.status}` };
    const setting = (await res.json()) as PinSetting;
    return { setting, error: null };
  } catch (e) {
    return { setting: null, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export default async function BidPinAdminPage() {
  await requireAdmin();
  const { setting, error } = await loadPin();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 font-display text-2xl text-slate-50">Bid Access PIN</h1>
      <p className="mb-6 text-sm text-slate-300">
        Members must enter this PIN before they can sign in to the bid site. Change it any time —
        the new value applies immediately to every device, and also reflects on the MBFD Hub
        admin&apos;s &ldquo;Bid Access PIN&rdquo; page.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-600 bg-amber-50/10 p-4 text-sm text-amber-200">
          Could not load the current PIN: {error}.
        </div>
      )}

      {setting && <BidPinForm initial={setting} />}
    </div>
  );
}
