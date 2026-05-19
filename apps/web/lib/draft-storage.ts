const PREFIX = 'mbfd-bid:draft:';

export function draftKey(route: string, formId: string): string {
  return `${PREFIX}${route}:${formId}`;
}

export interface DraftEnvelope<T> {
  values: T;
  savedAt: string; // ISO UTC
}

export function saveDraft<T>(route: string, formId: string, values: T): void {
  if (typeof window === 'undefined') return;
  const envelope: DraftEnvelope<T> = { values, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(draftKey(route, formId), JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage disabled — silently no-op.
  }
}

export function loadDraft<T>(route: string, formId: string): DraftEnvelope<T> | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(draftKey(route, formId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DraftEnvelope<T>;
  } catch {
    return null;
  }
}

export function deleteDraft(route: string, formId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(draftKey(route, formId));
}
