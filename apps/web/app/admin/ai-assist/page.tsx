import { requireAdmin } from '@/lib/require-admin';
import { AiAssistWorkspace } from './AiAssistWorkspace';

export default async function AiAssistPage() {
  await requireAdmin();

  return (
    <section className="mx-auto max-w-5xl">
      <AiAssistWorkspace />
    </section>
  );
}
