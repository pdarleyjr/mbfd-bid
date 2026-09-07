import Papa from 'papaparse';
import { isQualificationCalendarDate } from './qualification-lifecycle.js';

export type TargetCredentialRow = {
  rowNumber: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  credentialName: string;
  sourceCredentialId: string | null;
  status: 'active' | 'expired' | 'revoked';
  effectiveOn: string | null;
  expiresOn: string | null;
};
export type TargetClassification =
  | 'NEW_QUALIFICATION'
  | 'UNCHANGED'
  | 'FILL_MISSING_DATE'
  | 'RENEWAL'
  | 'EXPIRATION_REVIEW'
  | 'REVOCATION_REVIEW'
  | 'CONFLICT';
export const credentialSourceKey = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const headerKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function calendarDate(value: string): string | null {
  if (!value.trim()) return null;
  const source = value.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(source);
  const date = us ? `${us[3]}-${us[1]?.padStart(2, '0')}-${us[2]?.padStart(2, '0')}` : source;
  if (
    !isQualificationCalendarDate(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error(`Invalid calendar date: ${source}. Use YYYY-MM-DD or MM/DD/YYYY.`);
  return date;
}

export function parseTargetSolutions(text: string) {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  const errors = parsed.errors.map((e) => `CSV row ${(e.row ?? 0) + 1}: ${e.message}`);
  const headerIndex = parsed.data.findIndex(
    (row) =>
      row.some((v) => ['employeeid', 'empid'].includes(headerKey(v))) &&
      row.some((v) => headerKey(v) === 'credentialname'),
  );
  const header = (parsed.data[headerIndex] ?? []).map(headerKey);
  const index = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const employee = index('employeeid', 'empid');
  const credential = index('credentialname');
  const expires = index('expirationdate', 'expireson', 'expirydate');
  const effective = index('issuedate', 'completiondate', 'effectiveon');
  const statusIndex = index('credentialstatus', 'status');
  const preamble = parsed.data.slice(0, Math.max(0, headerIndex));
  const activeOnly = preamble.some(
    (row) =>
      row.some((v) => headerKey(v) === 'credentialstatus') &&
      row.some((v) => v.trim().toLowerCase() === 'active'),
  );
  const runDate = preamble.find((row) => headerKey(row[0] ?? '') === 'rundate')?.[1] ?? null;
  const stamp = runDate ? /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/.exec(runDate) : null;
  const month = stamp
    ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
        (stamp[1] ?? '').toLowerCase(),
      ) + 1
    : 0;
  const observedOn =
    stamp && month
      ? `${stamp[3]}-${String(month).padStart(2, '0')}-${stamp[2]?.padStart(2, '0')}`
      : null;
  if (headerIndex < 0) errors.push('Employee ID and Credential Name columns are required.');
  if (statusIndex < 0 && !activeOnly)
    errors.push(
      'Include a credential status column or the report Active credential-status filter.',
    );
  const rows: TargetCredentialRow[] = [];
  const seen = new Map<string, string>();
  for (const [offset, raw] of parsed.data
    .slice(headerIndex < 0 ? parsed.data.length : headerIndex + 1)
    .entries()) {
    const rowNumber = headerIndex + offset + 2;
    const value = (...names: string[]) => raw[index(...names)]?.trim() ?? '';
    try {
      const employeeId = raw[employee]?.trim() ?? '';
      const credentialName = raw[credential]?.trim() ?? '';
      if (!employeeId || employeeId.length > 128 || !credentialName || credentialName.length > 160)
        throw new Error(
          'Employee ID and credential name are required and must fit the supported lengths.',
        );
      const status = statusIndex < 0 ? 'active' : (raw[statusIndex] ?? '').trim().toLowerCase();
      if (!['active', 'expired', 'revoked'].includes(status))
        throw new Error(`Unsupported credential status: ${status || '(blank)'}`);
      const effectiveOn = calendarDate(raw[effective] ?? '');
      const expiresOn = calendarDate(raw[expires] ?? '');
      if (effectiveOn && expiresOn && effectiveOn > expiresOn)
        throw new Error('Issue/completion date is after expiration.');
      const row: TargetCredentialRow = {
        rowNumber,
        employeeId,
        credentialName,
        firstName: value('firstname'),
        lastName: value('lastname'),
        sourceCredentialId: value('credentialid') || null,
        status: status as TargetCredentialRow['status'],
        effectiveOn,
        expiresOn,
      };
      const key = `${employeeId}\u0000${credentialSourceKey(credentialName)}`;
      const content = JSON.stringify({ ...row, rowNumber: 0 });
      if (seen.has(key)) {
        if (seen.get(key) !== content)
          throw new Error('Conflicting duplicate employee/credential records.');
        // Exact duplicates remain accounted for by the report count, but produce one source row.
      } else {
        seen.set(key, content);
        rows.push(row);
      }
    } catch (e) {
      errors.push(`Row ${rowNumber}: ${e instanceof Error ? e.message : 'Invalid row'}`);
    }
  }
  if (!rows.length) errors.push('No valid credential records found.');
  if (rows.length > 25000) errors.push('The maximum import is 25,000 records.');
  return {
    rows,
    errors,
    observedOn,
    runDate,
    sourceRowCount: Math.max(0, parsed.data.length - headerIndex - 1),
    coverage: {
      activeOnly,
      expirationDates: expires >= 0,
      issueDates: effective >= 0,
      explicitStatus: statusIndex >= 0,
    },
  };
}

export function classifyTargetCredential(
  row: TargetCredentialRow,
  current: { status: string; effectiveOn: string | null; expiresOn: string | null } | undefined,
  observedOn: string,
): TargetClassification {
  if (
    (row.effectiveOn && row.effectiveOn > observedOn) ||
    (row.status === 'expired' && row.expiresOn && row.expiresOn >= observedOn)
  )
    return 'CONFLICT';
  if (row.status === 'revoked')
    return current?.status === 'revoked' ? 'UNCHANGED' : 'REVOCATION_REVIEW';
  if (row.status === 'expired' || (row.expiresOn && row.expiresOn < observedOn))
    return current?.status === 'expired' && (!row.expiresOn || row.expiresOn === current.expiresOn)
      ? 'UNCHANGED'
      : 'EXPIRATION_REVIEW';
  if (!current) return 'NEW_QUALIFICATION';
  if (current.effectiveOn && current.effectiveOn > observedOn) return 'CONFLICT';
  if (current.status !== 'active')
    return row.effectiveOn &&
      row.expiresOn &&
      row.effectiveOn > (current.effectiveOn ?? '') &&
      row.expiresOn >= observedOn
      ? 'RENEWAL'
      : 'CONFLICT';
  if (row.effectiveOn && current.effectiveOn && row.effectiveOn < current.effectiveOn)
    return 'CONFLICT';
  if (row.expiresOn && current.expiresOn && row.expiresOn < current.expiresOn) return 'CONFLICT';
  if (row.expiresOn && !current.expiresOn) return 'FILL_MISSING_DATE';
  if (
    (row.expiresOn && current.expiresOn && row.expiresOn > current.expiresOn) ||
    (row.effectiveOn && current.effectiveOn && row.effectiveOn > current.effectiveOn)
  )
    return 'RENEWAL';
  if (row.effectiveOn && !current.effectiveOn) return 'FILL_MISSING_DATE';
  return 'UNCHANGED';
}
