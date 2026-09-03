import { requirePin } from '@/lib/require-pin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { type Presentation, PresentationView } from './PresentationView';

export const dynamic = 'force-dynamic';

export default async function LivePresentationPage() {
  await requirePin();
  let initial: Presentation = { mode: 'OFF', session: null };
  try {
    const response = await serverWorkerFetch('/api/presentation');
    if (response.ok) initial = (await response.json()) as Presentation;
  } catch {
    // The client keeps polling the authenticated proxy. A transient Worker
    // outage must fail closed as OFF instead of publishing stale content.
  }
  return <PresentationView initial={initial} />;
}
