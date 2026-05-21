'use client';
import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Shared state for the admin manual-pick workflow.
 *
 * Flow:
 *   1. Admin toggles "Pick mode" on via LiveCommandBar → `pickMode = true`.
 *   2. Admin clicks a row in BidRoster → `selectedMemberId = N`.
 *   3. Admin clicks an empty position in StationGroupedGrid → `submitPick`
 *      POSTs the assignment and `router.refresh()` reloads the snapshot.
 *
 * For mock sessions the UI POSTs to `/api/admin/rehearsal/:id/manual-pick`.
 * For live sessions the existing Override dialog on the command bar handles
 * the step-up + reason flow; this hook refuses live picks so callers don't
 * accidentally bypass that gate.
 */

export interface ManualPickValue {
  pickMode: boolean;
  setPickMode: (v: boolean) => void;
  selectedMemberId: number | null;
  setSelectedMemberId: (id: number | null) => void;
  /** Resets selection + exits pick mode. */
  reset: () => void;
  /** Submit a pick. Returns `{ ok }` and surfaces a message via `lastError`. */
  submitPick: (input: {
    memberId: number;
    positionId: string;
    force?: boolean;
  }) => Promise<{ ok: boolean }>;
  submitting: boolean;
  lastError: string | null;
  clearError: () => void;
}

const ManualPickContext = createContext<ManualPickValue | null>(null);

interface ProviderProps {
  bidSessionId: string;
  isMock: boolean;
  children: ReactNode;
}

export function ManualPickProvider({ bidSessionId, isMock, children }: ProviderProps) {
  const [pickMode, setPickModeInternal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const router = useRouter();

  const setPickMode = useCallback((v: boolean) => {
    setPickModeInternal(v);
    if (!v) {
      setSelectedMemberId(null);
      setLastError(null);
    }
  }, []);

  const reset = useCallback(() => {
    setPickModeInternal(false);
    setSelectedMemberId(null);
    setLastError(null);
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const submitPick = useCallback(
    async (input: { memberId: number; positionId: string; force?: boolean }) => {
      setSubmitting(true);
      setLastError(null);
      try {
        if (!isMock) {
          setLastError(
            'Live sessions require step-up + reason. Use the Override button on the command bar.',
          );
          return { ok: false };
        }
        const res = await fetch(`/api/admin/rehearsal/${bidSessionId}/manual-pick`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: input.memberId,
            position_id: input.positionId,
            ...(input.force === true ? { force: true } : {}),
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          setLastError(`Pick rejected (${res.status}): ${text.slice(0, 250)}`);
          return { ok: false };
        }
        // Clear selection + refresh so the page shows the new fill.
        setSelectedMemberId(null);
        router.refresh();
        return { ok: true };
      } catch (e) {
        setLastError(e instanceof Error ? e.message : 'unknown error');
        return { ok: false };
      } finally {
        setSubmitting(false);
      }
    },
    [bidSessionId, isMock, router],
  );

  const value = useMemo<ManualPickValue>(
    () => ({
      pickMode,
      setPickMode,
      selectedMemberId,
      setSelectedMemberId,
      reset,
      submitPick,
      submitting,
      lastError,
      clearError,
    }),
    [pickMode, setPickMode, selectedMemberId, reset, submitPick, submitting, lastError, clearError],
  );

  return <ManualPickContext.Provider value={value}>{children}</ManualPickContext.Provider>;
}

const NOOP: ManualPickValue = {
  pickMode: false,
  setPickMode: () => {},
  selectedMemberId: null,
  setSelectedMemberId: () => {},
  reset: () => {},
  submitPick: async () => ({ ok: false }),
  submitting: false,
  lastError: null,
  clearError: () => {},
};

export function useManualPick(): ManualPickValue {
  return useContext(ManualPickContext) ?? NOOP;
}
