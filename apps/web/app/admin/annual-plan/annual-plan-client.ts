'use client';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
export type AnnualPlan = {
  year: number;
  effectiveOn: string | null;
  ruleBookVersion: string;
  ruleBookRevision: number;
  configurationRevision: number;
  sourceRevision: number;
  reviewRevision: number;
  reviewedSourceRevision: number | null;
  reviewedRuleRevision: number | null;
  sourceSessionId: string | null;
  lifecycle: string;
  settings: {
    v: number;
    credentialEvaluationOn?: string;
    turnTimerSeconds: number;
    expectedDurationDays: number;
  };
};
export const fieldClass =
  'mt-1 min-h-11 w-full min-w-0 rounded border border-border bg-card px-3 py-2 text-foreground';
export const buttonClass =
  'min-h-11 rounded border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-50';
export async function annualGet<T>(path: string): Promise<T> {
  const r = await fetch(`/api/admin/${path}`, { credentials: 'include' });
  const body = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error((body.error ?? `Request failed (${r.status})`).replaceAll('_', ' '));
  return body;
}
// Keep the authenticated bootstrap for this page lifetime. A fresh wrapper for
// every command needlessly hits the authentication endpoint during bulk work.
let annualMutationFetch: typeof fetch | undefined;
export class AnnualRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnnualRequestError';
  }
}
export async function annualPost<T>(path: string, body: unknown, key: string): Promise<T> {
  annualMutationFetch ??= createCsrfAwareFetch(fetch, () => window.location.origin);
  const r = await annualMutationFetch(`/api/admin/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  const result = (await r.json()) as T & {
    error?: string;
    conflicts?: { positionId: string; field: string; reason: string }[];
  };
  if (!r.ok)
    throw new AnnualRequestError(
      r.status,
      result.error ?? 'request_failed',
      [
        result.error?.replaceAll('_', ' ') ?? `Request failed (${r.status})`,
        ...(result.conflicts ?? []).map((c) => `${c.positionId}: ${c.field} — ${c.reason}`),
      ].join('\n'),
    );
  return result;
}
export function expectedPlan(plan: AnnualPlan) {
  return {
    expected_rule_revision: plan.ruleBookRevision,
    expected_configuration_revision: plan.configurationRevision,
    expected_source_revision: plan.sourceRevision,
  };
}
