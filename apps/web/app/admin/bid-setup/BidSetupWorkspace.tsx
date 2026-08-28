'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export type BidConfigurationLifecycle = 'UNCONFIGURED' | 'DRAFT' | 'FROZEN' | 'INCONSISTENT';

export interface BidConfiguration {
  bidYear: number;
  bidYearStatus: 'configuring' | 'live' | 'paused' | 'complete' | 'archived';
  ruleBookVersion: string | null;
  positionTemplateVersion: string | null;
  configurationRevision: number;
  ruleBookRevision: number | null;
  settings: {
    v: 1;
    expectedDurationDays: number;
    turnTimerSeconds: number;
  } | null;
  lifecycle: BidConfigurationLifecycle;
}

export interface RuleBookSummary {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
}

interface Props {
  year: number;
  configuration: BidConfiguration | null;
  ruleBooks: RuleBookSummary[];
  configurationError: string | null;
  ruleBooksError: string | null;
}

function lifecycleLabel(lifecycle: BidConfigurationLifecycle): string {
  switch (lifecycle) {
    case 'UNCONFIGURED':
      return 'Unconfigured';
    case 'DRAFT':
      return 'Draft designated';
    case 'FROZEN':
      return 'Frozen';
    case 'INCONSISTENT':
      return 'Inconsistent';
  }
}

function describeError(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error;
  }
  return fallback;
}

/**
 * The only mutable configuration control in the web app. It intentionally
 * sends both reads and writes through /api/admin/bid-configuration/:year;
 * secondary tools below are navigation aids, not alternate configuration
 * sources.
 */
export function BidSetupWorkspace({
  year,
  configuration,
  ruleBooks,
  configurationError,
  ruleBooksError,
}: Props) {
  const router = useRouter();
  const draftRuleBooks = ruleBooks.filter(
    (ruleBook) => ruleBook.effectiveYear === year && ruleBook.status === 'draft',
  );
  const [selectedVersion, setSelectedVersion] = useState(
    configuration?.ruleBookVersion ?? draftRuleBooks[0]?.version ?? '',
  );
  const [expectedDurationDays, setExpectedDurationDays] = useState(
    configuration?.settings?.expectedDurationDays ?? 2,
  );
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(
    configuration?.settings?.turnTimerSeconds ?? 180,
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const editable =
    configuration !== null &&
    configuration.bidYearStatus === 'configuring' &&
    (configuration.lifecycle === 'UNCONFIGURED' || configuration.lifecycle === 'DRAFT');

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (configuration === null || !selectedVersion) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/bid-configuration/${year}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rule_book_version: selectedVersion,
          expected_configuration_revision: configuration.configurationRevision,
          settings: {
            expected_duration_days: expectedDurationDays,
            turn_timer_seconds: turnTimerSeconds,
          },
          reason: reason.trim(),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(describeError(body, `Configuration update failed (${response.status}).`));
        return;
      }
      setSuccess(
        'The designated configuration was accepted by the server. Refreshing lifecycle state…',
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Configuration update failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="designated-configuration-heading"
        className="rounded-lg border border-slate-700 bg-slate-800/60 p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="designated-configuration-heading" className="font-heading text-lg text-white">
              Designated annual configuration
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              This is the one configuration source for rehearsal and eventual live sessions. A
              designation neither publishes a rule book nor starts a bid.
            </p>
          </div>
          <span className="rounded-full border border-slate-600 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200">
            Year {year}
          </span>
        </div>

        {configuration === null ? (
          <div className="mt-4 rounded border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-100">
            <h3 className="font-semibold">No configuration is available for this bid year</h3>
            <p className="mt-1">
              {configurationError ??
                'The designated configuration endpoint returned no configuration record.'}
            </p>
            <p className="mt-2 text-amber-100/90">
              No draft can be designated here until the annual configuration record exists. This
              page does not create a substitute configuration or staffing baseline.
            </p>
          </div>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-slate-400">Lifecycle</dt>
                <dd className="mt-0.5 font-semibold text-white">
                  {lifecycleLabel(configuration.lifecycle)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Configuration revision</dt>
                <dd className="mt-0.5 font-mono text-white">
                  {configuration.configurationRevision}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Rule book</dt>
                <dd className="mt-0.5 font-mono text-white">
                  {configuration.ruleBookVersion ?? 'Not designated'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Rule-book revision</dt>
                <dd className="mt-0.5 font-mono text-white">
                  {configuration.ruleBookRevision ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Position template</dt>
                <dd className="mt-0.5 font-mono text-white">
                  {configuration.positionTemplateVersion ?? 'Not designated'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Expected duration</dt>
                <dd className="mt-0.5 text-white">
                  {configuration.settings === null
                    ? 'Not designated'
                    : `${configuration.settings.expectedDurationDays} day(s)`}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Turn timer</dt>
                <dd className="mt-0.5 text-white">
                  {configuration.settings === null
                    ? 'Not designated'
                    : `${configuration.settings.turnTimerSeconds} seconds`}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Bid-year lifecycle</dt>
                <dd className="mt-0.5 text-white">{configuration.bidYearStatus}</dd>
              </div>
            </dl>

            {configuration.lifecycle === 'UNCONFIGURED' && (
              <p className="mt-4 rounded border border-amber-700 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                No designated draft is recorded. Select a draft candidate below; the server will
                independently validate it before accepting the designation.
              </p>
            )}

            {configuration.lifecycle === 'FROZEN' && (
              <p className="mt-4 rounded border border-slate-600 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                This configuration is frozen. It is read-only here; no replacement designation is
                offered.
              </p>
            )}

            {configuration.lifecycle === 'INCONSISTENT' && (
              <p className="mt-4 rounded border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-100">
                This configuration is inconsistent and is read-only. Resolve the recorded policy
                data through the approved lifecycle before attempting another designation.
              </p>
            )}

            {configuration.bidYearStatus !== 'configuring' && (
              <p className="mt-4 rounded border border-slate-600 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                This bid year is {configuration.bidYearStatus}; configuration changes are not
                available from this workspace.
              </p>
            )}

            {editable && draftRuleBooks.length === 0 && (
              <p className="mt-4 rounded border border-amber-700 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                No draft rule-book candidate is available for {year}. This page cannot infer or
                create one.
              </p>
            )}

            {editable && draftRuleBooks.length > 0 && (
              <form
                onSubmit={saveConfiguration}
                className="mt-5 space-y-4 border-t border-slate-700 pt-5"
              >
                <div>
                  <h3 className="font-heading text-base text-white">
                    {configuration.lifecycle === 'DRAFT'
                      ? 'Update designated draft configuration'
                      : 'Designate draft configuration'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-300">
                    Draft candidates come from the existing rule-book listing. The designated
                    configuration endpoint independently verifies draft status and coverage.
                  </p>
                </div>

                <label className="block max-w-lg">
                  <span className="text-sm text-slate-200">Draft rule-book candidate</span>
                  <select
                    value={selectedVersion}
                    onChange={(event) => setSelectedVersion(event.target.value)}
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-white"
                  >
                    {draftRuleBooks.map((ruleBook) => (
                      <option key={ruleBook.version} value={ruleBook.version}>
                        {ruleBook.version} (draft)
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-slate-200">Expected duration (days)</span>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      required
                      value={expectedDurationDays}
                      onChange={(event) => setExpectedDurationDays(Number(event.target.value))}
                      className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-200">Turn timer (seconds)</span>
                    <input
                      type="number"
                      min={30}
                      max={600}
                      required
                      value={turnTimerSeconds}
                      onChange={(event) => setTurnTimerSeconds(Number(event.target.value))}
                      className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
                    />
                  </label>
                </div>

                <label className="block max-w-2xl">
                  <span className="text-sm text-slate-200">Reason (4–500 characters)</span>
                  <textarea
                    required
                    minLength={4}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
                  />
                </label>

                {error !== null && (
                  <output aria-live="polite" className="block text-sm text-red-300">
                    {error}
                  </output>
                )}
                {success !== null && (
                  <output aria-live="polite" className="block text-sm text-emerald-300">
                    {success}
                  </output>
                )}

                <button
                  type="submit"
                  data-testid="bid-configuration-save"
                  disabled={submitting || reason.trim().length < 4 || !selectedVersion}
                  className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save designated configuration'}
                </button>
              </form>
            )}
          </>
        )}

        {ruleBooksError !== null && (
          <p className="mt-4 rounded border border-amber-700 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
            Rule-book candidates could not be loaded: {ruleBooksError}. No alternate configuration
            source is used.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="font-heading text-lg text-white">Existing setup tools</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          These are secondary review and editing tools. They do not replace the designated annual
          configuration shown above, and none of them starts a session or publishes a rule book.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href={'/admin/rule-books' as Route} className="font-medium text-red-300 underline">
            Rule Books
          </Link>
          <Link href={'/admin/positions' as Route} className="font-medium text-red-300 underline">
            Positions
          </Link>
          <Link href={'/admin/rules' as Route} className="font-medium text-red-300 underline">
            Rules
          </Link>
          <Link href={'/admin/eligibility' as Route} className="font-medium text-red-300 underline">
            Eligibility Preview
          </Link>
          <Link
            href={'/admin/settings/bid-pin' as Route}
            className="font-medium text-red-300 underline"
          >
            Bid Access PIN
          </Link>
        </div>
      </section>
    </div>
  );
}
