import { presentationApiPath } from '@/lib/presentation-link';
import { requirePin } from '@/lib/require-pin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { type Presentation, PresentationView } from './PresentationView';

export const dynamic = 'force-dynamic';

export default async function LivePresentationPage({
  searchParams,
}: {
  searchParams: Promise<{ bidSessionId?: string; session_id?: string; session?: string }>;
}) {
  await requirePin();
  const query = await searchParams;
  const sessionId = query.bidSessionId ?? query.session_id ?? query.session;
  let initial: Presentation = { mode: 'OFF', session: null };
  try {
    const response = await serverWorkerFetch(presentationApiPath(sessionId));
    if (response.ok) {
      const candidate = (await response.json()) as Presentation;
      if (sessionId === undefined || candidate.session?.id === sessionId) initial = candidate;
    }
  } catch {
    // The client keeps polling the authenticated proxy. A transient Worker
    // outage must fail closed as OFF instead of publishing stale content.
  }
  return (
    <PresentationView
      key={sessionId ?? 'active-real'}
      initial={initial}
      {...(sessionId === undefined ? {} : { sessionId })}
    />
  );
}
