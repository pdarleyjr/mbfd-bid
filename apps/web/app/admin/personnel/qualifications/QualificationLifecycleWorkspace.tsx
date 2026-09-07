'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useRetainedMutation } from '@/lib/use-retained-mutation';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

export interface QualificationMember {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string;
  employmentStatus: string;
}

export interface QualificationCredential {
  id: number;
  name: string;
  fyPointsDefault: number;
}

type QualificationEventKind =
  | 'CERTIFICATION_GAINED'
  | 'CERTIFICATION_EXPIRED'
  | 'CERTIFICATION_REVOKED'
  | 'SPECIALTY_QUALIFIED'
  | 'SPECIALTY_EXPIRED'
  | 'SPECIALTY_REVOKED'
  | 'SPECIALTY_REMOVED';
type QualificationStatus = 'active' | 'expired' | 'revoked' | 'removed';
type CertificationOrigin = 'lifecycle_evidence' | 'legacy_projection';

interface CertificationQualification {
  credentialId: number;
  credentialName: string | null;
  status: Exclude<QualificationStatus, 'removed'>;
  effectiveOn: string | null;
  expiresOn: string | null;
  evidenceSource: string | null;
  evidenceReference: string | null;
  eventId: string | null;
  origin: CertificationOrigin;
}

interface SpecialtyQualification {
  specialtyCode: string;
  status: QualificationStatus;
  effectiveOn: string;
  expiresOn: string | null;
  evidenceSource: string;
  evidenceReference: string | null;
  eventId: string;
}

interface QualificationLifecycleEvent {
  id: string;
  memberId: number;
  credentialId: number | null;
  credentialName: string | null;
  specialtyCode: string | null;
  kind: QualificationEventKind;
  effectiveOn: string;
  expiresOn: string | null;
  evidenceSource: string;
  evidenceReference: string | null;
  reason: string;
  actorSubject: string;
  idempotencyKey: string;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string;
}

interface QualificationHistory {
  memberId: number;
  asOf: string;
  certifications: CertificationQualification[];
  specialties: SpecialtyQualification[];
  events: QualificationLifecycleEvent[];
}

interface QualificationReceipt {
  eventId: string;
  replayed: boolean;
}

interface QualificationLifecycleWorkspaceProps {
  asOf: string;
  members: QualificationMember[];
  credentials: QualificationCredential[];
  memberIdHint?: number;
}

const EVENT_KIND_LABELS: Record<QualificationEventKind, string> = {
  CERTIFICATION_GAINED: 'Add, renew or correct certification',
  CERTIFICATION_EXPIRED: 'Record certification expiration',
  CERTIFICATION_REVOKED: 'Record certification revocation',
  SPECIALTY_QUALIFIED: 'Record specialty qualification',
  SPECIALTY_EXPIRED: 'Specialty expired',
  SPECIALTY_REVOKED: 'Specialty revoked',
  SPECIALTY_REMOVED: 'Specialty removed',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function asNullablePositiveInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return asPositiveInteger(value) ?? undefined;
}

function isQualificationStatus(value: unknown): value is QualificationStatus {
  return value === 'active' || value === 'expired' || value === 'revoked' || value === 'removed';
}

function isCertificationQualificationStatus(
  value: unknown,
): value is Exclude<QualificationStatus, 'removed'> {
  return value === 'active' || value === 'expired' || value === 'revoked';
}

function isQualificationEventKind(value: unknown): value is QualificationEventKind {
  return (
    value === 'CERTIFICATION_GAINED' ||
    value === 'CERTIFICATION_EXPIRED' ||
    value === 'CERTIFICATION_REVOKED' ||
    value === 'SPECIALTY_QUALIFIED' ||
    value === 'SPECIALTY_EXPIRED' ||
    value === 'SPECIALTY_REVOKED' ||
    value === 'SPECIALTY_REMOVED'
  );
}

function isCertificationEventKind(kind: QualificationEventKind): boolean {
  return !kind.startsWith('SPECIALTY_');
}

function isCertificationOrigin(value: unknown): value is CertificationOrigin {
  return value === 'lifecycle_evidence' || value === 'legacy_projection';
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function asNullableCalendarDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && isIsoCalendarDate(value) ? value : undefined;
}

function parseCertificationQualification(value: unknown): CertificationQualification | null {
  const record = asRecord(value);
  if (record === null) return null;
  const credentialId = asPositiveInteger(record.credentialId);
  const credentialName = asNullableString(record.credentialName);
  const effectiveOn = asNullableCalendarDate(record.effectiveOn);
  const expiresOn = asNullableCalendarDate(record.expiresOn);
  const evidenceSource = asNullableString(record.evidenceSource);
  const evidenceReference = asNullableString(record.evidenceReference);
  const eventId = asNullableString(record.eventId);
  if (
    credentialId === null ||
    credentialName === undefined ||
    !isCertificationQualificationStatus(record.status) ||
    effectiveOn === undefined ||
    expiresOn === undefined ||
    evidenceSource === undefined ||
    evidenceReference === undefined ||
    eventId === undefined ||
    !isCertificationOrigin(record.origin)
  ) {
    return null;
  }
  return {
    credentialId,
    credentialName,
    status: record.status,
    effectiveOn,
    expiresOn,
    evidenceSource,
    evidenceReference,
    eventId,
    origin: record.origin,
  };
}

function parseSpecialtyQualification(value: unknown): SpecialtyQualification | null {
  const record = asRecord(value);
  if (record === null) return null;
  const specialtyCode = asNonEmptyString(record.specialtyCode);
  const effectiveOn =
    typeof record.effectiveOn === 'string' && isIsoCalendarDate(record.effectiveOn)
      ? record.effectiveOn
      : null;
  const expiresOn = asNullableCalendarDate(record.expiresOn);
  const evidenceSource = asNonEmptyString(record.evidenceSource);
  const evidenceReference = asNullableString(record.evidenceReference);
  const eventId = asNonEmptyString(record.eventId);
  if (
    specialtyCode === null ||
    !isQualificationStatus(record.status) ||
    effectiveOn === null ||
    expiresOn === undefined ||
    evidenceSource === null ||
    evidenceReference === undefined ||
    eventId === null
  ) {
    return null;
  }
  return {
    specialtyCode,
    status: record.status,
    effectiveOn,
    expiresOn,
    evidenceSource,
    evidenceReference,
    eventId,
  };
}

function parseQualificationEvent(value: unknown): QualificationLifecycleEvent | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asNonEmptyString(record.id);
  const memberId = asPositiveInteger(record.memberId);
  const credentialId = asNullablePositiveInteger(record.credentialId);
  const credentialName = asNullableString(record.credentialName);
  const specialtyCode = asNullableString(record.specialtyCode);
  const effectiveOn =
    typeof record.effectiveOn === 'string' && isIsoCalendarDate(record.effectiveOn)
      ? record.effectiveOn
      : null;
  const expiresOn = asNullableCalendarDate(record.expiresOn);
  const evidenceSource = asNonEmptyString(record.evidenceSource);
  const evidenceReference = asNullableString(record.evidenceReference);
  const reason = asNonEmptyString(record.reason);
  const actorSubject = asNonEmptyString(record.actorSubject);
  const idempotencyKey = asNonEmptyString(record.idempotencyKey);
  const createdAt = asNonEmptyString(record.createdAt);
  if (
    id === null ||
    memberId === null ||
    credentialId === undefined ||
    credentialName === undefined ||
    specialtyCode === undefined ||
    !isQualificationEventKind(record.kind) ||
    effectiveOn === null ||
    expiresOn === undefined ||
    evidenceSource === null ||
    evidenceReference === undefined ||
    reason === null ||
    actorSubject === null ||
    idempotencyKey === null ||
    createdAt === null ||
    !Object.prototype.hasOwnProperty.call(record, 'beforeState') ||
    !Object.prototype.hasOwnProperty.call(record, 'afterState')
  ) {
    return null;
  }
  if (
    (isCertificationEventKind(record.kind) && (credentialId === null || specialtyCode !== null)) ||
    (!isCertificationEventKind(record.kind) && (credentialId !== null || specialtyCode === null))
  ) {
    return null;
  }
  return {
    id,
    memberId,
    credentialId,
    credentialName,
    specialtyCode,
    kind: record.kind,
    effectiveOn,
    expiresOn,
    evidenceSource,
    evidenceReference,
    reason,
    actorSubject,
    idempotencyKey,
    beforeState: record.beforeState,
    afterState: record.afterState,
    createdAt,
  };
}

function parseHistory(value: unknown): QualificationHistory | null {
  const record = asRecord(value);
  const memberId = record === null ? null : asPositiveInteger(record.memberId);
  const responseAsOf =
    record !== null && typeof record.asOf === 'string' && isIsoCalendarDate(record.asOf)
      ? record.asOf
      : null;
  if (
    record === null ||
    memberId === null ||
    responseAsOf === null ||
    !Array.isArray(record.certifications) ||
    !Array.isArray(record.specialties) ||
    !Array.isArray(record.events)
  ) {
    return null;
  }
  const certifications = record.certifications.map(parseCertificationQualification);
  const specialties = record.specialties.map(parseSpecialtyQualification);
  const events = record.events.map(parseQualificationEvent);
  if (
    certifications.some((item) => item === null) ||
    specialties.some((item) => item === null) ||
    events.some((item) => item === null)
  ) {
    return null;
  }
  return {
    memberId,
    asOf: responseAsOf,
    certifications: certifications as CertificationQualification[],
    specialties: specialties as SpecialtyQualification[],
    events: events as QualificationLifecycleEvent[],
  };
}

function parseReceipt(value: unknown): QualificationReceipt | null {
  const record = asRecord(value);
  const event = record === null ? null : asRecord(record.event);
  const eventId = event === null ? null : asNonEmptyString(event.id);
  if (record === null || eventId === null || typeof record.replayed !== 'boolean') return null;
  return { eventId, replayed: record.replayed };
}

function responseError(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const error = record === null ? null : asNonEmptyString(record.error);
  return error ?? fallback;
}

function isUnavailableEndpoint(response: Response, body: unknown): boolean {
  return (
    response.status === 501 || (response.status === 404 && responseError(body, '') === 'not_found')
  );
}

function lifecycleMemberUrl(memberId: number, asOf: string): string {
  return `/api/admin/qualification-lifecycle/members/${encodeURIComponent(String(memberId))}?as_of=${encodeURIComponent(asOf)}`;
}

function integrationUnavailableMessage(memberId: number, asOf: string): string {
  return `Qualification lifecycle backend unavailable. This workspace expects GET ${lifecycleMemberUrl(memberId, asOf)} and cannot infer a qualification status or history until that mounted contract is available.`;
}

function statusClass(status: QualificationStatus): string {
  if (status === 'active') return 'border-success/40 bg-success-surface text-success';
  if (status === 'expired') return 'border-warning/40 bg-warning-surface text-warning';
  return 'border-destructive/40 bg-destructive-surface text-destructive';
}

function statusLabel(status: QualificationStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function eventKindLabel(kind: QualificationEventKind): string {
  return EVENT_KIND_LABELS[kind];
}

function displayValue(value: string | null): string {
  return value ?? '—';
}

function displayTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : 'Unavailable';
}

function eventTargetLabel(event: QualificationLifecycleEvent): string {
  if (event.specialtyCode !== null) return `Specialty ${event.specialtyCode}`;
  if (event.credentialName !== null) return event.credentialName;
  return event.credentialId === null ? 'Unavailable' : `Credential #${event.credentialId}`;
}

/**
 * Mounted Worker contract:
 * - GET /api/admin/qualification-lifecycle/members/:memberId?as_of=YYYY-MM-DD
 *   -> { memberId, asOf, certifications, specialties, events }
 * - POST /api/admin/qualification-lifecycle/events with Idempotency-Key
 *   -> { replayed, event }
 *
 * The Worker owns the effective-dated ledger, projection, validation, and
 * immutable audit receipt. This UI never writes the retired direct credential
 * toggle path and does not infer status when the mounted endpoint is absent.
 */
export function QualificationLifecycleWorkspace({
  asOf,
  members,
  credentials,
  memberIdHint,
}: QualificationLifecycleWorkspaceProps) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const mutation = useRetainedMutation<Record<string, number | string>>('qualification');
  const selectedHint =
    memberIdHint !== undefined && members.some((member) => member.id === memberIdHint)
      ? memberIdHint
      : undefined;
  const [memberId, setMemberId] = useState(() => String(selectedHint ?? members[0]?.id ?? ''));
  const [credentialId, setCredentialId] = useState(() => String(credentials[0]?.id ?? ''));
  const [specialtyCode, setSpecialtyCode] = useState('');
  const [kind, setKind] = useState<QualificationEventKind>('CERTIFICATION_GAINED');
  const [effectiveOn, setEffectiveOn] = useState(asOf);
  const [expiresOn, setExpiresOn] = useState('');
  const [evidenceSource, setEvidenceSource] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<QualificationHistory | null>(null);
  const [receipt, setReceipt] = useState<QualificationReceipt | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState<string | null>(null);

  const selectedMemberId = Number(memberId);
  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  );
  const certificationEvent = isCertificationEventKind(kind);

  const loadHistory = useCallback(
    async (nextMemberId: number) => {
      setLoadingHistory(true);
      setHistory(null);
      setBackendUnavailable(null);
      setError(null);
      try {
        const response = await fetch(lifecycleMemberUrl(nextMemberId, asOf), {
          credentials: 'include',
        });
        const body: unknown = await response.json().catch(() => null);
        if (isUnavailableEndpoint(response, body)) {
          setBackendUnavailable(integrationUnavailableMessage(nextMemberId, asOf));
          return;
        }
        if (!response.ok) {
          setError(
            `Qualification history could not be loaded: ${responseError(body, `status_${response.status}`)}.`,
          );
          return;
        }
        const parsed = parseHistory(body);
        if (parsed === null || parsed.memberId !== nextMemberId || parsed.asOf !== asOf) {
          setError('Qualification history response did not match the mounted lifecycle contract.');
          return;
        }
        setHistory(parsed);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Qualification history could not be loaded.',
        );
      } finally {
        setLoadingHistory(false);
      }
    },
    [asOf],
  );

  useEffect(() => {
    if (!Number.isSafeInteger(selectedMemberId) || selectedMemberId <= 0) {
      setHistory(null);
      setBackendUnavailable(null);
      return;
    }
    void loadHistory(selectedMemberId);
  }, [loadHistory, selectedMemberId]);

  useEffect(() => {
    if (kind === 'CERTIFICATION_EXPIRED' || kind === 'SPECIALTY_EXPIRED') {
      setExpiresOn(effectiveOn);
    }
    if (
      kind === 'CERTIFICATION_REVOKED' ||
      kind === 'SPECIALTY_REVOKED' ||
      kind === 'SPECIALTY_REMOVED'
    ) {
      setExpiresOn('');
    }
  }, [effectiveOn, kind]);

  const formIssues = useMemo(() => {
    const issues: string[] = [];
    if (selectedMember === null) issues.push('Select a member.');
    if (
      certificationEvent &&
      (!Number.isSafeInteger(Number(credentialId)) || Number(credentialId) <= 0)
    ) {
      issues.push('Select a certification credential.');
    }
    if (!certificationEvent) {
      const trimmedSpecialtyCode = specialtyCode.trim();
      if (trimmedSpecialtyCode.length === 0 || trimmedSpecialtyCode.length > 128) {
        issues.push('Enter a specialty qualification code of 1–128 characters.');
      }
    }
    if (!isIsoCalendarDate(effectiveOn)) issues.push('Enter a valid effective date.');
    if (
      kind !== 'CERTIFICATION_REVOKED' &&
      kind !== 'SPECIALTY_REVOKED' &&
      kind !== 'SPECIALTY_REMOVED' &&
      kind !== 'CERTIFICATION_EXPIRED' &&
      kind !== 'SPECIALTY_EXPIRED' &&
      expiresOn !== '' &&
      !isIsoCalendarDate(expiresOn)
    ) {
      issues.push('Expiration date must be a valid calendar date.');
    }
    if (
      kind !== 'CERTIFICATION_REVOKED' &&
      kind !== 'SPECIALTY_REVOKED' &&
      kind !== 'SPECIALTY_REMOVED' &&
      kind !== 'CERTIFICATION_EXPIRED' &&
      kind !== 'SPECIALTY_EXPIRED' &&
      expiresOn !== '' &&
      expiresOn < effectiveOn
    ) {
      issues.push('Expiration date cannot precede the effective date.');
    }
    if (evidenceSource.trim().length < 1 || evidenceSource.trim().length > 128) {
      issues.push('Evidence source must be 1–128 characters.');
    }
    if (evidenceReference.trim().length > 512) {
      issues.push('Evidence reference must be 1–512 characters when supplied.');
    }
    if (reason.trim().length < 4 || reason.trim().length > 500) {
      issues.push('Reason must be 4–500 characters.');
    }
    return issues;
  }, [
    certificationEvent,
    credentialId,
    effectiveOn,
    evidenceReference,
    expiresOn,
    kind,
    reason,
    selectedMember,
    specialtyCode,
    evidenceSource,
  ]);

  async function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setReceipt(null);
    if (formIssues.length > 0) {
      setError(formIssues[0] ?? 'Complete the qualification evidence form.');
      return;
    }
    if (selectedMember === null) {
      setError('Select a member.');
      return;
    }

    const payload: Record<string, number | string> = {
      member_id: selectedMember.id,
      kind,
      effective_on: effectiveOn,
      evidence_source: evidenceSource.trim(),
      reason: reason.trim(),
    };
    if (certificationEvent) {
      payload.credential_id = Number(credentialId);
    } else {
      payload.specialty_code = specialtyCode.trim();
    }
    if (kind === 'CERTIFICATION_EXPIRED' || kind === 'SPECIALTY_EXPIRED') {
      payload.expires_on = effectiveOn;
    } else if (
      kind !== 'CERTIFICATION_REVOKED' &&
      kind !== 'SPECIALTY_REVOKED' &&
      kind !== 'SPECIALTY_REMOVED' &&
      expiresOn !== ''
    ) {
      payload.expires_on = expiresOn;
    }
    if (evidenceReference.trim() !== '') {
      payload.evidence_reference = evidenceReference.trim();
    }

    setBusy(true);
    try {
      const request = mutation.prepare(JSON.stringify(payload), () => payload);
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch('/api/admin/qualification-lifecycle/events', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.key,
        },
        body: JSON.stringify(request.payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (isUnavailableEndpoint(response, body)) {
        setBackendUnavailable(
          'Qualification lifecycle backend unavailable. No event was recorded because POST /api/admin/qualification-lifecycle/events is not available.',
        );
        return;
      }
      if (!response.ok) {
        setError(
          `Qualification event was not recorded: ${responseError(body, `status_${response.status}`)}.`,
        );
        return;
      }
      const parsedReceipt = parseReceipt(body);
      if (parsedReceipt === null) {
        setError('Qualification event response did not include an auditable lifecycle receipt.');
        return;
      }
      setReceipt(parsedReceipt);
      mutation.accepted(request.key);
      setNotice(
        parsedReceipt.replayed
          ? 'The original qualification lifecycle receipt was returned; no duplicate event was made.'
          : 'The qualification evidence event was accepted. History was reloaded from the lifecycle ledger.',
      );
      setReason('');
      await refreshProjections('qualification');
      await loadHistory(selectedMember.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Qualification event could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled =
    busy ||
    formIssues.length > 0 ||
    members.length === 0 ||
    (certificationEvent && credentials.length === 0);
  const expirationDisabled =
    kind === 'CERTIFICATION_EXPIRED' ||
    kind === 'SPECIALTY_EXPIRED' ||
    kind === 'CERTIFICATION_REVOKED' ||
    kind === 'SPECIALTY_REVOKED' ||
    kind === 'SPECIALTY_REMOVED';
  const expirationLabel =
    kind === 'CERTIFICATION_EXPIRED' || kind === 'SPECIALTY_EXPIRED'
      ? 'Expiration date (same as effective date)'
      : kind === 'CERTIFICATION_REVOKED' || kind === 'SPECIALTY_REVOKED'
        ? 'Expiration date (not used for revocation)'
        : kind === 'SPECIALTY_REMOVED'
          ? 'Expiration date (not used for removal)'
          : 'Expiration date (optional)';

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="qualification-lifecycle-heading"
        className="rounded-xl border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
              Effective-dated evidence control
            </p>
            <h2
              id="qualification-lifecycle-heading"
              className="mt-1 font-heading text-xl text-foreground"
            >
              Qualification lifecycle
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground">
              Record reviewed certification or specialty evidence with an effective date, optional
              expiration where allowed, source, evidence reference, and reason. No legacy direct
              credential toggle is available.
            </p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">
            As of {history?.asOf ?? asOf}
          </span>
        </div>

        <form
          data-testid="qualification-event-form"
          onSubmit={submitEvent}
          className="mt-5 grid gap-4 border-t border-border pt-5 lg:grid-cols-2"
        >
          <p className="text-sm text-foreground lg:col-span-2">
            Certification events require a certification credential. Specialty qualification code is
            a separate evidence target and is never sent with a credential ID.
          </p>

          <Label className="block">
            <span className="text-sm text-foreground">Member</span>
            <NativeSelect
              data-testid="qualification-member"
              required
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
                setReceipt(null);
                setNotice(null);
              }}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              {members.length === 0 && <option value="">No members available</option>}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.lastName}, {member.firstName} — {member.rank} ({member.employmentStatus})
                </option>
              ))}
            </NativeSelect>
          </Label>

          <Label className="block">
            <span className="text-sm text-foreground">Lifecycle event</span>
            <NativeSelect
              data-testid="qualification-kind"
              value={kind}
              onChange={(event) => {
                if (isQualificationEventKind(event.target.value)) setKind(event.target.value);
              }}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              {(Object.keys(EVENT_KIND_LABELS) as QualificationEventKind[]).map((option) => (
                <option key={option} value={option}>
                  {EVENT_KIND_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Label>

          {certificationEvent ? (
            <Label className="block">
              <span className="text-sm text-foreground">Certification credential</span>
              <NativeSelect
                data-testid="qualification-credential"
                required
                value={credentialId}
                onChange={(event) => setCredentialId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
              >
                {credentials.length === 0 && <option value="">No credentials available</option>}
                {credentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.name}{' '}
                    {credential.fyPointsDefault === 0
                      ? ''
                      : `(${credential.fyPointsDefault} points)`}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          ) : (
            <Label className="block">
              <span className="text-sm text-foreground">Specialty qualification code</span>
              <Input
                data-testid="qualification-specialty-code"
                required
                maxLength={128}
                value={specialtyCode}
                onChange={(event) => setSpecialtyCode(event.target.value)}
                placeholder="TECHNICAL_RESCUE"
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
              />
            </Label>
          )}

          <Label className="block">
            <span className="text-sm text-foreground">Effective date</span>
            <Input
              data-testid="qualification-effective-on"
              required
              type="date"
              value={effectiveOn}
              onChange={(event) => setEffectiveOn(event.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>

          <Label className="block">
            <span className="text-sm text-foreground">{expirationLabel}</span>
            <Input
              data-testid="qualification-expires-on"
              type="date"
              disabled={expirationDisabled}
              value={
                kind === 'CERTIFICATION_EXPIRED' || kind === 'SPECIALTY_EXPIRED'
                  ? effectiveOn
                  : expiresOn
              }
              onChange={(event) => setExpiresOn(event.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            />
            {(kind === 'CERTIFICATION_REVOKED' || kind === 'SPECIALTY_REVOKED') && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Revocation closes qualification validity; no expiration is sent.
              </span>
            )}
            {kind === 'SPECIALTY_REMOVED' && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Removal closes specialty qualification validity; no expiration is sent.
              </span>
            )}
          </Label>

          <Label className="block">
            <span className="text-sm text-foreground">Evidence source</span>
            <Input
              data-testid="qualification-source"
              required
              maxLength={128}
              value={evidenceSource}
              onChange={(event) => setEvidenceSource(event.target.value)}
              placeholder="State registry, certification office, reviewed case file"
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
            />
          </Label>

          <Label className="block">
            <span className="text-sm text-foreground">Evidence reference (optional)</span>
            <Input
              data-testid="qualification-evidence-reference"
              maxLength={512}
              value={evidenceReference}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="Case, registry, document, or controlled-record reference"
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
            />
          </Label>

          <Label className="block lg:col-span-2">
            <span className="text-sm text-foreground">Reason</span>
            <Textarea
              data-testid="qualification-reason"
              required
              minLength={4}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 min-h-24 w-full rounded border border-border bg-card px-3 py-2 text-foreground"
            />
          </Label>

          <div className="lg:col-span-2">
            {formIssues.length > 0 && (
              <output aria-live="polite" className="block text-sm text-warning">
                {formIssues[0]}
              </output>
            )}
            <Button
              data-testid="qualification-submit"
              type="submit"
              disabled={submitDisabled}
              className="mt-3 min-h-11 rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground hover:bg-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Recording evidence…' : 'Record qualification evidence'}
            </Button>
          </div>
        </form>
      </section>

      {backendUnavailable !== null && (
        <section
          aria-label="Qualification backend unavailable"
          className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning"
        >
          <h2 className="font-semibold">Qualification lifecycle backend unavailable</h2>
          <p className="mt-1">{backendUnavailable}</p>
          <p className="mt-2 text-warning">
            No qualification status or history was inferred. This fail-closed UI does not treat
            absent lifecycle data as qualification approval.
          </p>
        </section>
      )}

      {error !== null && (
        <output
          aria-live="assertive"
          className="block rounded border border-destructive/40 bg-destructive-surface px-4 py-3 text-sm text-destructive"
        >
          {error}
        </output>
      )}

      {notice !== null && (
        <output
          aria-live="polite"
          className="block rounded border border-success/40 bg-success-surface px-4 py-3 text-sm text-success"
        >
          {notice}
        </output>
      )}

      {receipt !== null && (
        <section
          className="rounded-xl border border-success/40 bg-success-surface p-4"
          aria-label="Qualification receipt"
        >
          <h2 className="font-semibold text-success">Lifecycle receipt</h2>
          <p className="mt-1 text-sm text-success">
            Event <span className="font-mono">{receipt.eventId}</span>
            {receipt.replayed
              ? ' was replayed without a duplicate write.'
              : ' was accepted for ledger review.'}
          </p>
        </section>
      )}

      <section
        aria-labelledby="qualification-status-heading"
        className="rounded-xl border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-info">
              Projected evidence
            </p>
            <h2
              id="qualification-status-heading"
              className="mt-1 font-heading text-xl text-foreground"
            >
              Current status
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground">
              Effective, expiration, and status values are displayed only from the Worker&apos;s
              effective-dated projection.
            </p>
          </div>
          {selectedMember !== null && (
            <Button
              type="button"
              onClick={() => void loadHistory(selectedMember.id)}
              disabled={loadingHistory}
              className="min-h-11 rounded border border-border px-4 text-sm font-semibold text-foreground hover:border-border disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingHistory ? 'Loading…' : 'Refresh history'}
            </Button>
          )}
        </div>

        {history === null && (
          <p className="mt-5 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
            {loadingHistory
              ? 'Loading qualification history…'
              : 'No current qualification projection is available from the lifecycle backend.'}
          </p>
        )}

        {history !== null && (
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section aria-labelledby="certification-status-heading">
              <h3 id="certification-status-heading" className="font-semibold text-foreground">
                Certification status
              </h3>
              {history.certifications.length === 0 ? (
                <p className="mt-3 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
                  The lifecycle backend returned no certification projections for this member.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded border border-border">
                  <Table className="w-full border-collapse text-sm">
                    <TableHeader className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <TableRow>
                        <TableHead className="px-3 py-2">Credential</TableHead>
                        <TableHead className="px-3 py-2">Status</TableHead>
                        <TableHead className="px-3 py-2">Effective / expiration</TableHead>
                        <TableHead className="px-3 py-2">Source / evidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.certifications.map((qualification) => (
                        <TableRow
                          key={qualification.credentialId}
                          className="border-t border-border"
                        >
                          <TableCell className="px-3 py-3 font-medium text-foreground">
                            {qualification.credentialName ??
                              `Credential #${qualification.credentialId}`}
                          </TableCell>
                          <TableCell className="px-3 py-3">
                            <span
                              className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(qualification.status)}`}
                            >
                              {statusLabel(qualification.status)}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-3 font-mono text-xs text-foreground">
                            <div>{displayValue(qualification.effectiveOn)}</div>
                            <div className="mt-1 text-muted-foreground">
                              expires {displayValue(qualification.expiresOn)}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-3 text-foreground">
                            <div>{displayValue(qualification.evidenceSource)}</div>
                            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                              {displayValue(qualification.evidenceReference)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section aria-labelledby="specialty-status-heading">
              <h3 id="specialty-status-heading" className="font-semibold text-foreground">
                Specialty qualification status
              </h3>
              {history.specialties.length === 0 ? (
                <p className="mt-3 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
                  The lifecycle backend returned no specialty qualification projections for this
                  member.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded border border-border">
                  <Table className="w-full border-collapse text-sm">
                    <TableHeader className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <TableRow>
                        <TableHead className="px-3 py-2">Specialty code</TableHead>
                        <TableHead className="px-3 py-2">Status</TableHead>
                        <TableHead className="px-3 py-2">Effective / expiration</TableHead>
                        <TableHead className="px-3 py-2">Source / evidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.specialties.map((specialty) => (
                        <TableRow key={specialty.specialtyCode} className="border-t border-border">
                          <TableCell className="px-3 py-3 font-mono text-xs font-semibold text-foreground">
                            {specialty.specialtyCode}
                          </TableCell>
                          <TableCell className="px-3 py-3">
                            <span
                              className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(specialty.status)}`}
                            >
                              {statusLabel(specialty.status)}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-3 font-mono text-xs text-foreground">
                            <div>{specialty.effectiveOn}</div>
                            <div className="mt-1 text-muted-foreground">
                              expires {displayValue(specialty.expiresOn)}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-3 text-foreground">
                            <div>{specialty.evidenceSource}</div>
                            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                              {displayValue(specialty.evidenceReference)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </div>
        )}
      </section>

      <section
        aria-labelledby="qualification-history-heading"
        className="rounded-xl border border-border bg-card p-5"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-info">
          Immutable audit trail
        </p>
        <h2
          id="qualification-history-heading"
          className="mt-1 font-heading text-xl text-foreground"
        >
          Qualification history
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Each lifecycle event retains its effective date, expiration, source/evidence, reason,
          operator subject, and recorded time. Historical evidence is not edited in place.
        </p>

        {history === null ? (
          <p className="mt-5 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
            No qualification history is displayed until the lifecycle backend returns an auditable
            response.
          </p>
        ) : history.events.length === 0 ? (
          <p className="mt-5 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
            The lifecycle backend returned no qualification history for this member.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded border border-border">
            <Table className="w-full border-collapse text-sm">
              <TableHeader className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <TableRow>
                  <TableHead className="px-3 py-2">Effective</TableHead>
                  <TableHead className="px-3 py-2">Event</TableHead>
                  <TableHead className="px-3 py-2">Credential / specialty</TableHead>
                  <TableHead className="px-3 py-2">Expiration</TableHead>
                  <TableHead className="px-3 py-2">Source / evidence</TableHead>
                  <TableHead className="px-3 py-2">Reason / audit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.events.map((qualificationEvent) => (
                  <TableRow
                    key={qualificationEvent.id}
                    className="border-t border-border align-top"
                  >
                    <TableCell className="px-3 py-3 font-mono text-xs text-foreground">
                      {qualificationEvent.effectiveOn}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-foreground">
                      {eventKindLabel(qualificationEvent.kind)}
                    </TableCell>
                    <TableCell className="px-3 py-3 font-medium text-foreground">
                      {eventTargetLabel(qualificationEvent)}
                    </TableCell>
                    <TableCell className="px-3 py-3 font-mono text-xs text-foreground">
                      {displayValue(qualificationEvent.expiresOn)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-foreground">
                      <div>{qualificationEvent.evidenceSource}</div>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {displayValue(qualificationEvent.evidenceReference)}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-foreground">
                      <div>{qualificationEvent.reason}</div>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        event {qualificationEvent.id} · {qualificationEvent.actorSubject} ·{' '}
                        {displayTimestamp(qualificationEvent.createdAt)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
