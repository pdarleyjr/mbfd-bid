import type { BidAdvisoryBundle, BidAdvisoryEvidenceSource } from '@mbfd/shared';

const SOURCE_LABELS: Readonly<Record<BidAdvisoryEvidenceSource, string>> = {
  canonical_session_state: 'Canonical session state',
  frozen_policy_snapshot: 'Frozen policy snapshot',
  candidate_order_result: 'Candidate order result',
  selection_result: 'Recorded selection state',
  eligibility_engine: 'Frozen eligibility rules',
  specialty_state: 'Frozen specialty state',
  a_day_engine: 'A-Day engine result',
  annual_operations_state: 'Annual operations state',
  accepted_staffing_baseline: 'Accepted staffing baseline',
  mock_session_flag: 'Mock session boundary',
};

const SEVERITY_CLASSES = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  attention: 'border-amber-200 bg-amber-50 text-amber-950',
  blocked: 'border-red-300 bg-red-50 text-red-950',
} as const;

interface Props {
  advisory: BidAdvisoryBundle;
}

/** Read-only rendering of server-composed explanations from the current board result. */
export function BidAdvisoryPanel({ advisory }: Props) {
  return (
    <aside
      aria-labelledby="bid-advisory-heading"
      data-testid="bid-advisory-panel"
      className="border-b border-stone-200 bg-white px-4 py-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
            Deterministic explanation
          </p>
          <h2 id="bid-advisory-heading" className="font-heading text-lg text-stone-950">
            BID Advisory
          </h2>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {`Authoritative state · sequence ${advisory.sequence}`}
        </p>
      </header>
      <p className="mt-1 max-w-4xl text-sm text-stone-600">
        These explanations describe the current frozen BID result. They do not calculate a second
        outcome, make a selection, or change operational state.
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {advisory.cards.map((card) => (
          <article
            key={card.kind}
            data-advisory-kind={card.kind}
            data-advisory-severity={card.severity}
            className={`rounded-lg border px-3 py-3 ${SEVERITY_CLASSES[card.severity]}`}
          >
            <h3 className="font-semibold">{card.title}</h3>
            <p className="mt-1 text-sm leading-5">{card.summary}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
              {card.sources.map((source) => SOURCE_LABELS[source]).join(' · ')}
            </p>
          </article>
        ))}
      </div>
    </aside>
  );
}
