'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnnualRequestError, annualGet, annualPost } from '../annual-plan/annual-plan-client';
import { LatestCredentialSource } from './LatestCredentialSource';
import {
  type CredentialWorkbook,
  credentialRowsToCsv,
  readCredentialWorkbook,
} from './credential-source-file';
import { retryImportGroup } from './import-retry';

type Row = {
  id: string;
  classification: string;
  member_id: number | null;
  credential_id: number | null;
  applied_at: number | null;
  source: {
    employeeId: string;
    firstName: string;
    lastName: string;
    credentialName: string;
    status: string;
    effectiveOn: string | null;
    expiresOn: string | null;
  };
  before: {
    reviewHold?: { status: string; reason: string };
    current: { status: string; effectiveOn: string | null; expiresOn: string | null } | null;
  } | null;
};
type Detail = {
  id: string;
  filename: string;
  observed_on: string;
  status: string;
  source_row_count: number;
  unique_row_count: number;
  coverage: {
    expirationDates: boolean;
    issueDates: boolean;
    explicitStatus: boolean;
    activeOnly: boolean;
    authoritativeBaseline?: boolean;
  };
  counts: Record<string, number>;
  rows: Row[];
  source_receipt?: {
    workbook_hash: string;
    selected_sheet: string;
    source_revision: number;
    row_count: number;
    unique_employee_count: number;
    observed_at: string;
    source_filename: string;
    approved_at: number | null;
  } | null;
};
const labels: Record<string, string> = {
  NEW_QUALIFICATION: 'New qualifications',
  UNCHANGED: 'Unchanged',
  FILL_MISSING_DATE: 'Missing dates filled',
  RENEWAL: 'Renewals',
  FUTURE_RENEWAL: 'Scheduled renewals (current interval retained)',
  ANOMALOUS_DATE_REVIEW: 'Unusual source dates to verify',
  EXPIRATION_REVIEW: 'Expiration review',
  REVOCATION_REVIEW: 'Revocation review',
  CONFLICT: 'Conflicting evidence',
  UNKNOWN_MEMBER: 'Unmatched Employee IDs',
  AMBIGUOUS_MEMBER: 'Ambiguous Employee IDs',
  UNKNOWN_QUALIFICATION: 'Credential names to map',
  REFERENCE_REVIEW: 'Assessments to classify',
  REFERENCE_ONLY: 'Reference records',
  APPLIED: 'Reconciled',
  REJECTED: 'Rejected source records',
  NOT_REVIEWED: 'Awaiting comparison',
};
const label = (value: string) => labels[value] ?? value.replaceAll('_', ' ');
function importHref(basePath: string, importId: string): Route {
  const [pathname, query = ''] = basePath.split('?', 2);
  const params = new URLSearchParams(query);
  if (importId) params.set('import', importId);
  else params.delete('import');
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ''}` as Route;
}

export function TargetSolutionsWorkspace({
  basePath = '/admin/targetsolutions',
}: { basePath?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const id = params.get('import') ?? '';
  const departmentMode = basePath.split('?', 1)[0]?.startsWith('/admin/department/');
  const Heading = departmentMode ? 'h2' : 'h1';
  const [impact, setImpact] = useState<{
    positionCount: number;
    members: { memberId: number; firstName: string; lastName: string; employeeId: string }[];
    affectedLists: {
      positionId: string;
      positionLabel: string;
      gained: number[];
      lost: number[];
      orderingChanged: boolean;
    }[];
  } | null>(null);
  const impactHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (impact) {
      impactHeading.current?.scrollIntoView?.({ block: 'start' });
      impactHeading.current?.focus({ preventScroll: true });
    }
  }, [impact]);
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<CredentialWorkbook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState('');
  const fileReadGeneration = useRef(0);
  const [retainedFile, setRetainedFile] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('');
  const [mappingName, setMappingName] = useState('');
  const [distinct, setDistinct] = useState<string[]>([]);
  const [confirmDistinct, setConfirmDistinct] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [unresolvedRequest, setUnresolvedRequest] = useState(false);
  useUnsavedChanges(
    busy || unresolvedRequest || reason.trim() !== '' || (file !== null && file !== retainedFile),
    'import review notes or pending requests',
  );
  const stop = useRef(false);
  const retryController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      stop.current = true;
      retryController.current?.abort();
    },
    [],
  );
  const list = useQuery({
    queryKey: ['targetsolutions', 'list'],
    queryFn: () =>
      annualGet<{
        imports: { id: string; filename: string; observed_on: string; status: string }[];
        latestApprovedSource?: { importId: string } | null;
      }>('targetsolutions/imports'),
  });

  const recheckImportId = id || list.data?.latestApprovedSource?.importId;
  const requestedRecheck = params.get('recheck') === '1';
  useEffect(() => {
    if (!requestedRecheck || !recheckImportId) return;
    let active = true;
    setBusy(true);
    annualGet<NonNullable<typeof impact>>(
      `targetsolutions/imports/${recheckImportId}/eligibility-impact`,
    )
      .then((result) => {
        if (active) setImpact(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setFailed(true);
          setMessage(
            error instanceof Error
              ? error.message
              : 'Eligibility check could not be loaded. Retry the check.',
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [requestedRecheck, recheckImportId]);
  const detail = useQuery({
    queryKey: ['targetsolutions', id, category, offset],
    queryFn: () =>
      annualGet<Detail>(
        `targetsolutions/imports/${id}?category=${encodeURIComponent(category)}&offset=${offset}`,
      ),
    enabled: !!id,
  });
  const catalog = useQuery({
    queryKey: ['targetsolutions', 'catalog'],
    queryFn: () =>
      annualGet<{
        credentials: { id: number; name: string; displayName: string }[];
        mappings: {
          source_name: string;
          source_key: string;
          credential_id: number | null;
          treatment: string;
          created_at: number;
        }[];
      }>('targetsolutions/catalog'),
  });
  const sourceNames = useQuery({
    queryKey: ['targetsolutions', id, 'names'],
    queryFn: () =>
      annualGet<{ names: { name: string; classification: string; n: number }[] }>(
        `targetsolutions/imports/${id}/names`,
      ),
    enabled: !!id,
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['targetsolutions'] }),
      client.invalidateQueries({ queryKey: ['admin', 'department'] }),
    ]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    setMessage('');
    let workFinished = false;
    try {
      await work();
      workFinished = true;
      await refresh();
    } catch (e) {
      if (
        !workFinished &&
        (!(e instanceof AnnualRequestError) ||
          (e.status >= 500 && e.code !== 'authorization_unavailable')) &&
        !(e instanceof Error && e.message === 'csrf_bootstrap_failed')
      ) {
        // A later unrelated successful action cannot resolve this missing receipt.
        // Keep the navigation warning until the operator deliberately leaves.
        setUnresolvedRequest(true);
      }
      await refresh();
      setFailed(true);
      setMessage(
        e instanceof Error
          ? e.message === 'csrf_bootstrap_failed'
            ? 'The secure connection could not be renewed. Your saved import and completed groups are retained. Wait briefly and retry; if it continues, sign in again below and resume this import.'
            : e.message
          : 'The action could not complete. Refresh the review before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    const selected = workbook?.revisions.find((revision) => revision.sheet === selectedSheet);
    if (/\.xlsx$/i.test(file.name) && !selected) return;
    await action(async () => {
      const result = await annualPost<{ id: string }>(
        'targetsolutions/imports',
        {
          csv: selected ? credentialRowsToCsv(selected.data) : await file.text(),
          filename: file.name,
          ...(date ? { observed_on: date } : {}),
          ...(selected && workbook
            ? {
                source_receipt: {
                  workbook_hash: workbook.hash,
                  selected_sheet: selected.sheet,
                  source_revision: selected.revision,
                  row_count: selected.rowCount,
                  unique_employee_count: selected.employeeCount,
                  source_filename: file.name,
                },
              }
            : {}),
        },
        crypto.randomUUID(),
      );
      setRetainedFile(file);
      router.replace(importHref(basePath, result.id));
      await annualPost(
        `targetsolutions/imports/${result.id}/review`,
        { accept: true },
        crypto.randomUUID(),
      );
      setMessage(
        'File saved and compared. Review the changes and mappings below. No member qualifications have been changed.',
      );
    });
  }
  async function applySafe() {
    stop.current = false;
    const controller = new AbortController();
    retryController.current = controller;
    await action(async () => {
      let processed = 0;
      let remaining = 1;
      while (remaining > 0 && !stop.current) {
        const key = crypto.randomUUID();
        const result = await retryImportGroup(
          () =>
            annualPost<{ processed: number; remainingSafe: number }>(
              `targetsolutions/imports/${id}/apply`,
              { safe: true, reason },
              key,
            ),
          controller.signal,
          (seconds) =>
            setMessage(
              `Hub authorization is temporarily unavailable or busy. Completed groups are saved. Retrying this group in ${seconds} seconds; you can stop at any time.`,
            ),
        );
        if (result === null) break;
        processed += result.processed;
        remaining = result.remainingSafe;
        setMessage(`Reconciled ${processed} records this run. ${remaining} ready records remain.`);
        // Keep progress live without reloading four protected views after each
        // twenty-row command. Each actual mutation still revalidates with Hub.
        if (processed % 200 === 0 || remaining === 0) await refresh();
        if (!result.processed) break;
      }
      setMessage(
        stop.current
          ? 'Stopped after the current group. Applied changes are saved; resume this import at any time.'
          : 'Approved additions and updates reconciled. Review any remaining exceptions and the coverage notice.',
      );
    });
  }
  async function map(sourceName: string, selection: string, expectedRevision?: number) {
    await action(async () => {
      await annualPost(
        'targetsolutions/mappings',
        {
          source_name: sourceName,
          ...(expectedRevision === undefined
            ? {}
            : { expected_mapping_revision: expectedRevision }),
          reason,
          ...(selection === 'new'
            ? { create_new: true }
            : selection === 'reference'
              ? { reference_only: true }
              : { credential_id: Number(selection) }),
        },
        crypto.randomUUID(),
      );
      if (id)
        await annualPost(
          `targetsolutions/imports/${id}/review`,
          { accept: true },
          crypto.randomUUID(),
        );
      setMessage(
        'Mapping saved. The import comparison has been refreshed; review it before applying.',
      );
    });
  }
  const batch = detail.data;
  const safeCount = batch
    ? [
        'NEW_QUALIFICATION',
        'FILL_MISSING_DATE',
        'RENEWAL',
        'FUTURE_RENEWAL',
        'UNCHANGED',
        'REFERENCE_ONLY',
      ].reduce((n, k) => n + (batch.counts[k] ?? 0), 0)
    : 0;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">People / Credential imports</p>
        <Heading className="mt-1 font-heading text-3xl">Update credentials</Heading>
        <p className="mt-2 max-w-3xl">
          Upload an approved TargetSolutions or TeleStaff CSV, or the authoritative annual Bid
          workbook. Review differences before applying them. Employee IDs identify people; existing
          qualifications retain their history.
        </p>
      </header>
      <LatestCredentialSource />
      <nav aria-label="Credential update tasks" className="flex flex-wrap gap-3">
        <Link
          href="/admin/current-bid?view=blueprint"
          className="inline-flex min-h-11 items-center font-semibold underline"
        >
          RETURN TO CURRENT BID
        </Link>
        <Button
          disabled={!recheckImportId || busy}
          onClick={() =>
            void action(async () => {
              setImpact(
                await annualGet(`targetsolutions/imports/${recheckImportId}/eligibility-impact`),
              );
            })
          }
        >
          RECHECK BID ELIGIBILITY
        </Button>
      </nav>
      <ol className="flex flex-wrap gap-x-6 gap-y-2 rounded border border-border p-4 text-sm">
        <li>1. Upload latest credential file</li>
        <li>2. Select source revision</li>
        <li>3. Compare</li>
        <li>4. Apply safe changes</li>
        <li>5. Review only exceptions</li>
        <li>6. Verify eligibility changes</li>
      </ol>
      {impact && (
        <section className="rounded border border-border p-4">
          <h2 ref={impactHeading} tabIndex={-1} className="font-semibold">
            Eligibility changes
          </h2>
          <p>
            {impact.positionCount} candidate lists checked · {impact.affectedLists.length} changed
          </p>
          <ul className="space-y-2">
            {impact.affectedLists.map((list) => (
              <li key={list.positionId}>
                {list.positionLabel}: {list.gained.length} gained eligibility · {list.lost.length}{' '}
                lost eligibility ·{' '}
                {list.orderingChanged ? 'candidate order changed' : 'candidate order unchanged'}
                {(list.gained.length > 0 || list.lost.length > 0) && (
                  <details>
                    <summary className="min-h-11 cursor-pointer content-center">
                      See affected members
                    </summary>
                    {(['gained', 'lost'] as const).map(
                      (change) =>
                        list[change].length > 0 && (
                          <p key={change}>
                            {change === 'gained' ? 'Gained' : 'Lost'}:{' '}
                            {list[change]
                              .map((id) => {
                                const member = impact.members.find((m) => m.memberId === id);
                                return member
                                  ? `${member.firstName} ${member.lastName} (${member.employeeId})`
                                  : 'Member identity unavailable';
                              })
                              .join(', ')}
                          </p>
                        ),
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
          <Link
            className="inline-flex min-h-11 items-center underline"
            href="/admin/current-bid?view=mock"
          >
            RUN A MOCK BID
          </Link>
        </section>
      )}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">1–3. Upload latest file and compare</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Label>
            Credential report (CSV or approved Excel workbook)
            <Input
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                const generation = ++fileReadGeneration.current;
                setFile(next);
                setWorkbook(null);
                setSelectedSheet('');
                setMessage('');
                if (next && /\.xlsx$/i.test(next.name)) {
                  setBusy(true);
                  void readCredentialWorkbook(next)
                    .then((result) => {
                      if (generation !== fileReadGeneration.current) return;
                      setWorkbook(result);
                      setSelectedSheet(result.revisions[0]?.sheet ?? '');
                    })
                    .catch((error: unknown) => {
                      if (generation !== fileReadGeneration.current) return;
                      setFailed(true);
                      setMessage(
                        error instanceof Error ? error.message : 'The workbook could not be read.',
                      );
                    })
                    .finally(() => {
                      if (generation === fileReadGeneration.current) setBusy(false);
                    });
                }
              }}
            />
          </Label>
          <Label>
            Report date (only if the file does not provide it)
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
            />
          </Label>
        </div>
        {workbook && (
          <div className="mt-4">
            <Label htmlFor="credential-source-revision">Credential revision</Label>
            <NativeSelect
              id="credential-source-revision"
              value={selectedSheet}
              disabled={busy}
              onChange={(e) => setSelectedSheet(e.target.value)}
            >
              {workbook.revisions.map((revision, index) => (
                <option key={revision.sheet} value={revision.sheet}>
                  Version {revision.revision}
                  {index === 0 ? ' — Latest in this workbook' : ''} ·{' '}
                  {revision.rowCount.toLocaleString()} rows · {revision.employeeCount} employees
                </option>
              ))}
            </NativeSelect>
            <p className="mt-2 text-sm text-muted-foreground">
              The selected revision will be saved with the workbook hash. Earlier revisions remain
              available for comparison.
            </p>
          </div>
        )}
        <Button
          className="mt-4"
          disabled={!file || busy || (/\.xlsx$/i.test(file.name) && !selectedSheet)}
          onClick={() => void upload()}
        >
          Upload and compare
        </Button>
        {batch?.source_receipt && (
          <div className="mt-4 text-sm">
            <p>
              Saved source: {batch.source_receipt.source_filename} · Version{' '}
              {batch.source_receipt.source_revision} · {batch.source_receipt.selected_sheet}
            </p>
            <p>
              {batch.source_receipt.row_count.toLocaleString()} rows ·{' '}
              {batch.source_receipt.unique_employee_count} employees · observed{' '}
              {batch.source_receipt.observed_at}
            </p>
            <p className="break-all">SHA-256: {batch.source_receipt.workbook_hash}</p>
            <p>
              {batch.source_receipt.approved_at
                ? `Last approved application: ${new Date(batch.source_receipt.approved_at).toLocaleString()}`
                : 'No records applied yet.'}
            </p>
          </div>
        )}
        <Label className="mt-5 block">
          Resume a saved import
          <NativeSelect
            value={id}
            disabled={busy}
            onChange={(e) => {
              setCategory('');
              setOffset(0);
              router.replace(importHref(basePath, e.target.value));
            }}
          >
            <option value="">Choose an import</option>
            {list.data?.imports.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename} · {item.observed_on}
              </option>
            ))}
          </NativeSelect>
        </Label>
      </section>
      {(message || list.error || detail.error || catalog.error) && (
        <p
          role={failed || list.error || detail.error || catalog.error ? 'alert' : 'status'}
          className="rounded border border-border bg-card p-4"
        >
          {message || list.error?.message || detail.error?.message || catalog.error?.message}
          {failed && (
            <span className="mt-2 block">
              <a
                className="underline"
                href={`/api/auth/start?returnTo=${encodeURIComponent(importHref(basePath, id))}`}
                target="_blank"
                rel="noreferrer"
              >
                Sign in again and return to this import
              </a>
              . Completed groups will not be duplicated. Enter your review note and apply the
              remaining records.
            </span>
          )}
        </p>
      )}
      {id && detail.isPending && <output>Loading the saved comparison…</output>}
      <Label className="mt-3 block">
        Review note
        <Input
          placeholder="Source reviewed and reason for the updates"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Label>
      {id && (
        <details className="rounded-lg border border-border p-4">
          <summary>Review distinct new credential names in one batch</summary>
          <p className="my-3 text-sm">
            Select only definitions that are genuinely distinct from the existing catalog. Use
            individual mappings for an alternate name, failed assessment, identifier or
            reference-only record. New definitions start with zero points and do not change approved
            bid rules.
          </p>
          <p className="my-3 text-sm">
            Review the existing catalog above or use Qualification catalog under People before
            confirming.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDistinct(
                sourceNames.data?.names
                  .filter((n) => n.classification === 'UNKNOWN_QUALIFICATION')
                  .map((n) => n.name) ?? [],
              );
              setConfirmDistinct(false);
            }}
          >
            Select all distinct-name candidates for review
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDistinct([]);
              setConfirmDistinct(false);
            }}
          >
            Clear selection
          </Button>
          <div className="my-3 max-h-96 overflow-auto space-y-2">
            {sourceNames.data?.names
              .filter((n) => n.classification === 'UNKNOWN_QUALIFICATION')
              .map((n) => (
                <Label className="flex items-start gap-2" key={n.name}>
                  <input
                    type="checkbox"
                    checked={distinct.includes(n.name)}
                    onChange={(e) => {
                      setDistinct((old) =>
                        e.target.checked ? [...old, n.name] : old.filter((v) => v !== n.name),
                      );
                      setConfirmDistinct(false);
                    }}
                  />
                  {n.name} ({n.n} records)
                </Label>
              ))}
          </div>
          <Label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmDistinct}
              onChange={(e) => setConfirmDistinct(e.target.checked)}
            />
            I reviewed these names and confirm they are distinct definitions, not aliases of
            existing qualifications.
          </Label>
          <Button
            className="mt-3"
            disabled={busy || !confirmDistinct || !distinct.length || reason.trim().length < 4}
            onClick={() =>
              void action(async () => {
                await annualPost(
                  `targetsolutions/imports/${id}/register-names`,
                  { names: distinct, reason, confirm_distinct: true },
                  crypto.randomUUID(),
                );
                setDistinct([]);
                setConfirmDistinct(false);
                await annualPost(
                  `targetsolutions/imports/${id}/review`,
                  { accept: true },
                  crypto.randomUUID(),
                );
                setMessage(
                  'Distinct definitions registered with zero points. Review the refreshed member changes before applying.',
                );
              })
            }
          >
            Register reviewed definitions with zero points
          </Button>
        </details>
      )}
      <details className="rounded-lg border border-border p-4">
        <summary>Review or correct a saved credential mapping</summary>
        <p className="my-3 text-sm">
          A mapping correction affects pending and future imports. Earlier applied records and
          decisions remain in history. Review affected member qualifications separately if an
          earlier mapping was incorrect.
        </p>
        <Label>
          Source credential name
          <NativeSelect value={mappingName} onChange={(e) => setMappingName(e.target.value)}>
            <option value="">Select a saved mapping</option>
            {catalog.data?.mappings.map((m) => (
              <option key={m.source_key} value={m.source_name}>
                {m.source_name} →{' '}
                {m.treatment === 'reference_only'
                  ? 'Reference only'
                  : (catalog.data?.credentials.find((c) => c.id === m.credential_id)?.displayName ??
                    'Catalog review needed')}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {mappingName && (
          <MappingChoice
            credentials={catalog.data?.credentials ?? []}
            disabled={busy || reason.trim().length < 4}
            onSave={(choice) =>
              void map(
                mappingName,
                choice,
                catalog.data?.mappings.find((m) => m.source_name === mappingName)?.created_at,
              )
            }
          />
        )}
        <p className="mt-2 text-xs">Enter a review note above before saving.</p>
      </details>
      {batch && (
        <>
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">5. Review only exceptions</h2>
            <p className="mt-2">
              {batch.filename} · observed {batch.observed_on} ·{' '}
              {batch.source_row_count.toLocaleString()} source rows ·{' '}
              {batch.unique_row_count.toLocaleString()} distinct records
            </p>
            <aside className="my-4 rounded border border-warning/40 bg-warning-surface p-4 text-sm">
              {batch.coverage.expirationDates
                ? 'Expiration dates supplied in the report are compared; blank dates preserve existing information.'
                : 'Expiration reconciliation is unavailable: this report has no expiration-date column.'}{' '}
              {batch.coverage.activeOnly
                ? 'This is an active-only report. Missing rows never expire or remove qualifications.'
                : 'Only explicit supplied statuses are considered.'}{' '}
              Importing a record does not itself grant bid points.
            </aside>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setCategory('');
                  setOffset(0);
                }}
              >
                All records
              </Button>
              {Object.entries(batch.counts).map(([name, count]) => (
                <Button
                  key={name}
                  variant={category === name ? 'default' : 'secondary'}
                  disabled={busy}
                  onClick={() => {
                    setCategory(name);
                    setOffset(0);
                  }}
                >
                  {label(name)} ({count})
                </Button>
              ))}
            </div>
            <Button
              className="mt-4"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await annualPost(
                    `targetsolutions/imports/${id}/review`,
                    { accept: true },
                    crypto.randomUUID(),
                  );
                  setMessage(
                    'Comparison refreshed against current personnel and qualification history.',
                  );
                })
              }
            >
              Refresh comparison
            </Button>
          </section>
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">4. Apply safe changes</h2>

            <p className="my-3 text-sm">
              Apply processes ready records in resumable groups. Expiration, revocation, conflicting
              evidence and unmatched records remain for individual review.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={
                  busy || reason.trim().length < 4 || safeCount === 0 || batch.status !== 'reviewed'
                }
                onClick={() => void applySafe()}
              >
                APPLY SAFE CHANGES ({safeCount.toLocaleString()})
              </Button>
              {busy && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    stop.current = true;
                    retryController.current?.abort();
                  }}
                >
                  Stop after current group
                </Button>
              )}
            </div>
          </section>
          <section aria-label="Credential import records" className="space-y-3">
            {batch.rows.map((row) => (
              <article key={row.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">{row.source.credentialName}</h3>
                  <span className="text-sm">
                    {row.before?.reviewHold
                      ? 'NEEDS ADMIN EVIDENCE — qualification withheld from Bid eligibility'
                      : row.classification === 'REJECTED'
                        ? 'Rejected source record'
                        : row.applied_at
                          ? 'Reconciled'
                          : label(row.classification)}
                  </span>
                </div>
                <p className="text-sm">
                  {row.source.lastName}, {row.source.firstName} · Employee ID{' '}
                  {row.source.employeeId}
                </p>
                <p className="mt-2 text-sm">
                  Source: {row.source.status} · Issue/completion:{' '}
                  {row.source.effectiveOn ?? 'not supplied'} · Expiration:{' '}
                  {row.source.expiresOn ?? 'not supplied'}
                </p>
                {row.before?.current && (
                  <p className="text-sm">
                    Recorded: {row.before.current.status} · Expiration:{' '}
                    {row.before.current.expiresOn ?? 'not recorded'}
                  </p>
                )}
                {!row.applied_at &&
                  ['UNKNOWN_QUALIFICATION', 'REFERENCE_REVIEW'].includes(row.classification) && (
                    <MappingChoice
                      credentials={catalog.data?.credentials ?? []}
                      disabled={busy || reason.trim().length < 4}
                      onSave={(selection) => void map(row.source.credentialName, selection)}
                    />
                  )}
                {!row.applied_at &&
                  ['EXPIRATION_REVIEW', 'REVOCATION_REVIEW'].includes(row.classification) && (
                    <Button
                      className="mt-3"
                      variant="secondary"
                      disabled={busy || reason.trim().length < 4}
                      onClick={() =>
                        void action(async () => {
                          await annualPost(
                            `targetsolutions/imports/${id}/apply`,
                            { row_ids: [row.id], accept_adverse: true, reason },
                            crypto.randomUUID(),
                          );
                          setMessage(
                            'Reviewed status change recorded. Qualification history is preserved.',
                          );
                        })
                      }
                    >
                      Approve this{' '}
                      {row.classification === 'EXPIRATION_REVIEW' ? 'expiration' : 'revocation'}
                    </Button>
                  )}
                {!row.applied_at &&
                  [
                    'CONFLICT',
                    'EXPIRATION_REVIEW',
                    'REVOCATION_REVIEW',
                    'UNKNOWN_MEMBER',
                    'AMBIGUOUS_MEMBER',
                    'REFERENCE_REVIEW',
                    'UNKNOWN_QUALIFICATION',
                  ].includes(row.classification) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-3"
                      disabled={busy || reason.trim().length < 4}
                      onClick={() =>
                        void action(async () => {
                          await annualPost(
                            `targetsolutions/imports/${id}/reject`,
                            { row_ids: [row.id], reason },
                            crypto.randomUUID(),
                          );
                          setMessage(
                            'Imported assertion rejected with your review note. Source history retained; existing records unchanged.',
                          );
                        })
                      }
                    >
                      Keep current record — reject this source assertion
                    </Button>
                  )}
                {!row.applied_at &&
                  ['CONFLICT', 'ANOMALOUS_DATE_REVIEW'].includes(row.classification) && (
                    <Button
                      variant="secondary"
                      disabled={busy || reason.trim().length < 4}
                      onClick={() =>
                        void action(async () => {
                          await annualPost(
                            `targetsolutions/imports/${id}/reject`,
                            { row_ids: [row.id], reason, needs_admin_evidence: true },
                            crypto.randomUUID(),
                          );
                          setMessage(
                            'NEEDS ADMIN EVIDENCE recorded. Only this qualification is withheld from Bid eligibility until later approved evidence resolves it; source history is preserved.',
                          );
                        })
                      }
                    >
                      Needs admin evidence — withhold this qualification
                    </Button>
                  )}
                {!row.applied_at && row.classification === 'CONFLICT' && (
                  <p className="mt-3 text-sm">
                    Resolve the contradictory evidence in{' '}
                    <Link
                      className="underline"
                      href={
                        `${departmentMode ? '/admin/department' : '/admin/personnel/qualifications'}?memberId=${row.member_id}` as Route
                      }
                    >
                      this member’s qualifications
                    </Link>
                    , then refresh the comparison. Approval alone cannot resolve a contradiction.
                  </p>
                )}
                {!row.applied_at &&
                  ['UNKNOWN_MEMBER', 'AMBIGUOUS_MEMBER'].includes(row.classification) && (
                    <p className="mt-3 text-sm">
                      No identity was inferred.{' '}
                      <Link
                        className="underline"
                        href={(departmentMode ? '/admin/department' : '/admin/members') as Route}
                      >
                        Review personnel and the Employee ID
                      </Link>
                      , then refresh this comparison.
                    </p>
                  )}
              </article>
            ))}
            {!batch.rows.length && <p>No records in this category.</p>}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                disabled={busy || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous 100
              </Button>
              <span className="self-center text-sm">
                Records {batch.rows.length ? offset + 1 : 0}–{offset + batch.rows.length}
              </span>
              <Button
                variant="secondary"
                disabled={busy || batch.rows.length < 100}
                onClick={() => setOffset(offset + 100)}
              >
                Next 100
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
function MappingChoice({
  credentials,
  disabled,
  onSave,
}: {
  credentials: { id: number; name: string; displayName: string }[];
  disabled: boolean;
  onSave: (selection: string) => void;
}) {
  const [selection, setSelection] = useState('');
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <Label className="min-w-0 flex-1">
        How should this source item be recorded?
        <NativeSelect
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a mapping after reviewing the source</option>
          <option value="reference">Keep as a reference only — no qualification or points</option>
          <option value="new">Create a distinct qualification with zero default points</option>
          {credentials.map((item) => (
            <option key={item.id} value={item.id}>
              Link to {item.displayName}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <Button
        variant="secondary"
        disabled={disabled || !selection}
        onClick={() => onSave(selection)}
      >
        Save mapping and compare
      </Button>
    </div>
  );
}
