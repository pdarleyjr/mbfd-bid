import { requireAdmin } from '@/lib/require-admin';

/**
 * Deliberately non-operational. Future assistance must remain advisory and
 * cannot determine eligibility, seniority, or an award.
 */
export default async function AiAssistPage() {
  await requireAdmin();

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="ai-assist-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Decision support boundary
        </p>
        <h1 id="ai-assist-heading" className="mt-1 font-heading text-2xl text-white">
          AI Assist
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          This control area is reserved for future, reviewed decision-support configuration.
        </p>
      </header>

      <div
        data-testid="ai-assist-unavailable"
        className="border-l-4 border-amber-500 bg-amber-950/30 px-4 py-4 text-sm text-amber-100"
      >
        <p className="font-semibold">No AI assistance is configured</p>
        <p className="mt-1 text-amber-100/90">
          This release exposes no model, prompt, recommendation, automation, or commit control. If
          assistance is approved later, it will be advisory only and will never determine
          eligibility, bid order, or an award.
        </p>
      </div>
    </section>
  );
}
