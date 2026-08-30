'use client';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /** D1 mock-control revision, never the canonical DO event sequence. */
  mockControlRevision: number | null;
  children: ReactNode;
}

interface ManualPickResponse {
  bid_id?: string;
  mock_control_revision?: number;
  error?: string;
  detail?: string;
  reasons?: { code: string }[];
  current_mock_control_revision?: number;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `manual-pick-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ManualPickProvider({
  bidSessionId,
  isMock,
  mockControlRevision,
  children,
}: ProviderProps) {
  const [pickMode, setPickModeInternal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const router = useRouter();
  const mockControlRevisionRef = useRef<number | null>(mockControlRevision);
  const commandKeys = useRef(new Map<string, { key: string; revision: number }>());

  useEffect(() => {
    mockControlRevisionRef.current = mockControlRevision;
    for (const [logicalKey, command] of commandKeys.current) {
      if (command.revision !== mockControlRevision) commandKeys.current.delete(logicalKey);
    }
  }, [mockControlRevision]);

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
        const expectedRevision = mockControlRevisionRef.current;
        if (expectedRevision === null) {
          setLastError('Mock control state is unavailable. Refresh before submitting a pick.');
          return { ok: false };
        }
        const logicalKey = `${input.memberId}:${input.positionId}:${input.force === true ? 'force' : 'normal'}`;
        const command = commandKeys.current.get(logicalKey);
        const request =
          command?.revision === expectedRevision
            ? command
            : { key: newIdempotencyKey(), revision: expectedRevision };
        commandKeys.current.set(logicalKey, request);
        const res = await fetch(`/api/admin/rehearsal/${bidSessionId}/manual-pick`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': request.key,
          },
          body: JSON.stringify({
            member_id: input.memberId,
            position_id: input.positionId,
            ...(input.force === true ? { force: true } : {}),
            expected_mock_control_revision: request.revision,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          let parsed: ManualPickResponse = {};
          try {
            parsed = JSON.parse(text) as ManualPickResponse;
          } catch {
            // server returned something other than JSON — fall back to raw
          }
          if (parsed.error === 'stale_mock_control_revision') {
            mockControlRevisionRef.current = parsed.current_mock_control_revision ?? null;
            commandKeys.current.clear();
            router.refresh();
          } else if (res.status < 500 && parsed.error !== 'rehearsal_command_outcome_unknown') {
            commandKeys.current.delete(logicalKey);
          }
          setLastError(humanizePickError(res.status, parsed, text));
          return { ok: false };
        }
        const body = (await res.json()) as ManualPickResponse;
        if (typeof body.mock_control_revision === 'number') {
          mockControlRevisionRef.current = body.mock_control_revision;
        }
        commandKeys.current.clear();
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

/**
 * Convert worker error envelopes into a short, actionable sentence the
 * chief can read at-a-glance. Falls back to the raw response text if the
 * payload isn't shaped like an error JSON.
 */
function humanizePickError(status: number, body: ManualPickResponse, raw: string): string {
  if (body.error === 'position_already_filled') {
    return 'That position is already filled. Reset the mock session to clear picks, or choose a different position.';
  }
  if (body.error === 'ineligible') {
    const codes = body.reasons?.map((r) => r.code).join(', ') ?? '';
    return `This member is not eligible for that position${codes ? ` (${codes})` : ''}. Toggle Force-pick to override.`;
  }
  if (body.error === 'not_mock_session') {
    return 'This session is live — manual picks here are mock-only. Use Override on the command bar instead.';
  }
  if (body.error === 'member_not_found') {
    return 'Member not found in the database.';
  }
  if (body.error === 'rule_not_found_for_position' || body.error === 'no_active_rule_book') {
    return 'No active rule book covers that position. Activate a rule book in /admin/rule-books first.';
  }
  if (body.error === 'session_not_found') {
    return 'The session you are picking on no longer exists. Refresh the page.';
  }
  if (body.error === 'stale_mock_control_revision') {
    return 'The mock board changed. It has been refreshed; review it before trying again.';
  }
  if (body.error === 'rehearsal_command_outcome_unknown') {
    return 'The command outcome is unknown. Do not submit it again; refresh and contact an administrator.';
  }
  if (status === 401 || status === 403) {
    return `Permission denied (${status}). Try signing back in as an admin.`;
  }
  if (status >= 500) {
    return `Server error (${status}). The pick outcome may be unknown; do not resubmit until the board is refreshed. ${body.detail ?? raw.slice(0, 150)}`;
  }
  return `Pick rejected (${status}): ${body.detail ?? body.error ?? raw.slice(0, 200)}`;
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
