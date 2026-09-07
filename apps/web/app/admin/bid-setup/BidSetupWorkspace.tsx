'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  type BidConfiguration,
  type BidConfigurationLifecycle,
  buildBoundToolHref,
  isBoundBidConfiguration,
} from '../../../lib/bid-configuration-selection';

export type { BidConfiguration, BidConfigurationLifecycle };

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
    case 'LEGACY_EVALUATION_DATE_REQUIRED':
      return 'Credential date required';
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

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
  const positionsHref = configuration
    ? buildBoundToolHref('/admin/positions', configuration)
    : null;
  const rulesHref = configuration ? buildBoundToolHref('/admin/rules', configuration) : null;
  const eligibilityHref = configuration
    ? buildBoundToolHref('/admin/eligibility', configuration)
    : null;
  const draftRuleBooks = ruleBooks.filter(
    (ruleBook) => ruleBook.effectiveYear === year && ruleBook.status === 'draft',
  );
  const [selectedVersion, setSelectedVersion] = useState(
    configuration?.lifecycle === 'FROZEN' ? '' : (configuration?.ruleBookVersion ?? ''),
  );
  const [expectedDurationDays, setExpectedDurationDays] = useState(
    configuration?.settings?.expectedDurationDays ?? 2,
  );
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(
    configuration?.settings?.turnTimerSeconds ?? 180,
  );
  const [credentialEvaluationOn, setCredentialEvaluationOn] = useState(
    configuration?.settings?.v === 2 || configuration?.settings?.v === 3
      ? configuration.settings.credentialEvaluationOn
      : '',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconcilingStationSix, setReconcilingStationSix] = useState(false);
  const [bootstrappingReviewedSource, setBootstrappingReviewedSource] = useState(false);

  const editable =
    configuration !== null &&
    configuration.bidYearStatus === 'configuring' &&
    (configuration.lifecycle === 'UNCONFIGURED' ||
      configuration.lifecycle === 'DRAFT' ||
      configuration.lifecycle === 'LEGACY_EVALUATION_DATE_REQUIRED' ||
      (configuration.lifecycle === 'FROZEN' && draftRuleBooks.length > 0));

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (configuration === null || !selectedVersion) return;
    if (!isIsoCalendarDate(credentialEvaluationOn)) {
      setError('Select a valid credential evaluation date before saving this configuration.');
      return;
    }

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
            credential_evaluation_on: credentialEvaluationOn,
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

  async function reconcileStationSix() {
    setError(null);
    setSuccess(null);
    setReconcilingStationSix(true);
    try {
      const response = await fetch('/api/admin/positions/reconcile-station-six', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason_code: 'rule_override.policy_direction',
          reason:
            'Reconcile the 2026 Station 6 template to the reviewed policy and 2026-08-24 staffing source.',
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(describeError(body, `Station 6 reconciliation failed (${response.status}).`));
        return;
      }
      setSuccess('Station 6 and Marine Float Pool were reconciled. Refreshing the draft state…');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Station 6 reconciliation failed.');
    } finally {
      setReconcilingStationSix(false);
    }
  }

  async function bootstrapReviewed2026Source() {
    setError(null);
    setSuccess(null);
    setBootstrappingReviewedSource(true);
    try {
      const response = await fetch('/api/admin/positions/bootstrap-reviewed-2026-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason_code: 'rule_override.policy_direction',
          reason: 'Initialize the user-supplied reviewed 2026 source package for configuration.',
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          describeError(body, `Reviewed source initialization failed (${response.status}).`),
        );
        return;
      }
      setSuccess('The reviewed 2026 source and editable draft were initialized. Refreshing…');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reviewed source initialization failed.');
    } finally {
      setBootstrappingReviewedSource(false);
    }
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="designated-configuration-heading"
        className="rounded-lg border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="designated-configuration-heading"
              className="font-heading text-lg text-foreground"
            >
              Designated annual configuration
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-foreground">
              This is the one configuration source for rehearsal and eventual live sessions. A
              designation neither publishes a rule book nor starts a bid.
            </p>
          </div>
          <span className="rounded-full border border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
            Year {year}
          </span>
        </div>

        {(configuration?.lifecycle === 'UNCONFIGURED' ||
          (configuration?.lifecycle === 'DRAFT' &&
            configuration.ruleBookVersion === '2026.2' &&
            configuration.positionTemplateVersion === '2026.2')) &&
          draftRuleBooks.some((ruleBook) => ruleBook.version === '2026.2') && (
            <div className="mt-4 rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
              <p className="font-semibold">2026 staffing-source reconciliation required</p>
              <p className="mt-1">
                The reviewed policy requires four Fire Boat roles and two Marine Float Pool roles
                per A/B/C shift. This creates a new 2026.2 template and retargets only the 2026.2
                draft; it does not publish a rule book or start a bid.
              </p>
              <Button
                type="button"
                onClick={reconcileStationSix}
                disabled={reconcilingStationSix}
                className="mt-3 min-h-11 rounded bg-warning px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-warning disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reconcilingStationSix
                  ? 'Reconciling Station 6…'
                  : 'Reconcile 2026 Marine staffing'}
              </Button>
            </div>
          )}

        {configuration === null ? (
          <div className="mt-4 rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
            <h3 className="font-semibold">No configuration is available for this bid year</h3>
            <p className="mt-1">
              {configurationError ??
                'The designated configuration endpoint returned no configuration record.'}
            </p>
            <p className="mt-2 text-warning">
              No draft can be designated here until the annual configuration record exists. This
              page does not create a substitute configuration or staffing baseline.
            </p>
          </div>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Lifecycle</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {lifecycleLabel(configuration.lifecycle)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Configuration revision</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {configuration.configurationRevision}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rule book</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {configuration.ruleBookVersion ?? 'Not designated'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rule-book revision</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {configuration.ruleBookRevision ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Position template</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {configuration.positionTemplateVersion ?? 'Not designated'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expected duration</dt>
                <dd className="mt-0.5 text-foreground">
                  {configuration.settings === null
                    ? 'Not designated'
                    : `${configuration.settings.expectedDurationDays} day(s)`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Turn timer</dt>
                <dd className="mt-0.5 text-foreground">
                  {configuration.settings === null
                    ? 'Not designated'
                    : `${configuration.settings.turnTimerSeconds} seconds`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credential evaluation date</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {configuration.settings?.v === 2 || configuration.settings?.v === 3
                    ? configuration.settings.credentialEvaluationOn
                    : 'Required before a new session'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bid-year lifecycle</dt>
                <dd className="mt-0.5 text-foreground">{configuration.bidYearStatus}</dd>
              </div>
            </dl>

            {configuration.lifecycle === 'UNCONFIGURED' && (
              <p className="mt-4 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
                No designated draft is recorded. Select a draft candidate below; the server will
                independently validate it before accepting the designation.
              </p>
            )}

            {configuration.lifecycle === 'FROZEN' && (
              <p className="mt-4 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
                The designated rule book remains frozen. A reviewed replacement draft can be
                designated only while this bid year is configuring, and the server blocks the
                replacement if any real session history exists. Replacing the designation clears the
                prior annual-policy binding so the new draft must be reviewed and published.
              </p>
            )}

            {configuration.lifecycle === 'INCONSISTENT' && (
              <p className="mt-4 rounded border border-destructive/40 bg-destructive-surface px-3 py-2 text-sm text-destructive">
                This configuration is inconsistent and is read-only. Resolve the recorded policy
                data through the approved lifecycle before attempting another designation.
              </p>
            )}

            {configuration.lifecycle === 'LEGACY_EVALUATION_DATE_REQUIRED' && (
              <p className="mt-4 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
                Legacy configuration settings are displayed for review, but they cannot create a new
                mock or live session because no credential evaluation date was frozen. Select the
                approved calendar date and save a new configuration revision before continuing.
              </p>
            )}

            {configuration.bidYearStatus !== 'configuring' && (
              <p className="mt-4 rounded border border-border bg-card px-3 py-2 text-sm text-foreground">
                This bid year is {configuration.bidYearStatus}; configuration changes are not
                available from this workspace.
              </p>
            )}

            {editable && draftRuleBooks.length === 0 && year !== 2026 && (
              <p className="mt-4 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
                No draft rule-book candidate is available for {year}. This page cannot infer or
                create one.
              </p>
            )}

            {editable && draftRuleBooks.length === 0 && year === 2026 && (
              <div className="mt-4 rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
                <p className="font-semibold">Reviewed source package is ready to initialize</p>
                <p className="mt-1">
                  Create the traceable 2026.1 source snapshot and editable 2026.2 draft from the
                  supplied policy, staffing, assignment, credential, and workbook package. This does
                  not designate, publish, or start a Bid.
                </p>
                <Button
                  data-testid="reviewed-2026-source-bootstrap"
                  type="button"
                  onClick={bootstrapReviewed2026Source}
                  disabled={bootstrappingReviewedSource}
                  className="mt-3 min-h-11 rounded bg-warning px-4 py-2 font-semibold text-primary-foreground hover:bg-warning disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bootstrappingReviewedSource
                    ? 'Initializing reviewed source…'
                    : 'Initialize reviewed 2026 source'}
                </Button>
              </div>
            )}

            {editable && draftRuleBooks.length > 0 && (
              <form
                onSubmit={saveConfiguration}
                className="mt-5 space-y-4 border-t border-border pt-5"
              >
                <div>
                  <h3 className="font-heading text-base text-foreground">
                    {configuration.lifecycle === 'DRAFT'
                      ? 'Update designated draft configuration'
                      : configuration.lifecycle === 'FROZEN'
                        ? 'Designate reviewed replacement draft'
                        : configuration.lifecycle === 'LEGACY_EVALUATION_DATE_REQUIRED'
                          ? 'Upgrade legacy designated configuration'
                          : 'Designate draft configuration'}
                  </h3>
                  <p className="mt-1 text-sm text-foreground">
                    Draft candidates come from the existing rule-book listing. The designated
                    configuration endpoint independently verifies draft status and coverage.
                  </p>
                </div>

                <Label className="block max-w-lg">
                  <span className="text-sm text-foreground">Draft rule-book candidate</span>
                  <NativeSelect
                    value={selectedVersion}
                    onChange={(event) => setSelectedVersion(event.target.value)}
                    className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 font-mono text-foreground"
                  >
                    {(configuration.lifecycle === 'UNCONFIGURED' ||
                      configuration.lifecycle === 'FROZEN') && (
                      <option value="">Select a draft candidate</option>
                    )}
                    {draftRuleBooks.map((ruleBook) => (
                      <option key={ruleBook.version} value={ruleBook.version}>
                        {ruleBook.version} (draft)
                      </option>
                    ))}
                  </NativeSelect>
                </Label>

                <div className="grid max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
                  <Label className="block">
                    <span className="text-sm text-foreground">Expected duration (days)</span>
                    <Input
                      type="number"
                      min={1}
                      max={7}
                      required
                      value={expectedDurationDays}
                      onChange={(event) => setExpectedDurationDays(Number(event.target.value))}
                      className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
                    />
                  </Label>
                  <Label className="block">
                    <span className="text-sm text-foreground">Turn timer (seconds)</span>
                    <Input
                      type="number"
                      min={30}
                      max={600}
                      required
                      value={turnTimerSeconds}
                      onChange={(event) => setTurnTimerSeconds(Number(event.target.value))}
                      className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
                    />
                  </Label>
                </div>

                <Label className="block max-w-lg">
                  <span className="text-sm text-foreground">Credential evaluation date</span>
                  <Input
                    data-testid="credential-evaluation-on"
                    type="date"
                    required
                    value={credentialEvaluationOn}
                    onChange={(event) => setCredentialEvaluationOn(event.target.value)}
                    className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Credential lifecycle evidence for new sessions is frozen as of this approved
                    date; it is not inferred from the session start time.
                  </span>
                </Label>

                <Label className="block max-w-2xl">
                  <span className="text-sm text-foreground">Reason (4–500 characters)</span>
                  <Textarea
                    required
                    minLength={4}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
                  />
                </Label>

                {error !== null && (
                  <output aria-live="polite" className="block text-sm text-destructive">
                    {error}
                  </output>
                )}
                {success !== null && (
                  <output aria-live="polite" className="block text-sm text-success">
                    {success}
                  </output>
                )}

                <Button
                  type="submit"
                  data-testid="bid-configuration-save"
                  disabled={
                    submitting ||
                    reason.trim().length < 4 ||
                    !selectedVersion ||
                    !isIsoCalendarDate(credentialEvaluationOn)
                  }
                  className="rounded bg-destructive px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-destructive disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save designated configuration'}
                </Button>
              </form>
            )}
          </>
        )}

        {ruleBooksError !== null && (
          <p className="mt-4 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
            Rule-book candidates could not be loaded: {ruleBooksError}. No alternate configuration
            source is used.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-lg text-foreground">Existing setup tools</h2>
        <p className="mt-1 max-w-3xl text-sm text-foreground">
          These are secondary review and editing tools. They do not replace the designated annual
          configuration shown above, and none of them starts a session or publishes a rule book.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link
            href={'/admin/rule-books' as Route}
            className="font-medium text-destructive underline"
          >
            Rule Books
          </Link>
          {positionsHref !== null ? (
            <Link href={positionsHref as Route} className="font-medium text-destructive underline">
              Positions
            </Link>
          ) : (
            <span className="text-muted-foreground">
              Positions (designate a complete configuration first)
            </span>
          )}
          {rulesHref !== null ? (
            <Link href={rulesHref as Route} className="font-medium text-destructive underline">
              Rules
            </Link>
          ) : (
            <span className="text-muted-foreground">
              Rules (designate a complete configuration first)
            </span>
          )}
          {eligibilityHref !== null ? (
            <Link
              href={eligibilityHref as Route}
              className="font-medium text-destructive underline"
            >
              Eligibility Preview
            </Link>
          ) : (
            <span className="text-muted-foreground">
              Eligibility Preview (designate a complete configuration first)
            </span>
          )}
          <Link
            href={'/admin/settings/bid-pin' as Route}
            className="font-medium text-destructive underline"
          >
            Bid Access PIN
          </Link>
        </div>
        {!isBoundBidConfiguration(configuration) && (
          <p className="mt-3 text-sm text-warning">
            Positions, Rules, and Eligibility Preview remain unavailable until this bid year has a
            complete designated configuration. No tool will substitute a default version.
          </p>
        )}
      </section>
    </div>
  );
}
