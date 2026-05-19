// apps/web/lib/a-day-client.ts
//
// Typed client helpers for the Phase 2 (A-Day) REST + WS surface.
// Plan 07 Task 15: extracted from the picker UI so the network layer can be
// unit-tested without DOM dependencies.

import type {
  ADayPickMadeMessage,
  ADayRejectMessage,
  ADayValue,
  PhaseChangedMessage,
  SubmitADayPickRequest,
} from '@mbfd/shared';
import {
  ADayPickMadeMessageSchema,
  ADayRejectMessageSchema,
  PhaseChangedMessageSchema,
} from '@mbfd/shared';

export type ADayBoardState = {
  currentPhase: 'config' | 'position_bid' | 'a_day_bid' | 'paused' | 'complete';
  isMyTurn: boolean;
  shift: 'A' | 'B' | 'C' | 'D' | null;
  eligibleADays: string[];
  meters: {
    groups: Array<{
      shift: 'A' | 'B' | 'C';
      group: 'G1' | 'G2' | 'G3' | 'G4';
      meter: {
        total: number;
        max?: number;
        officers: number;
        officersRequired?: number;
        isFull: boolean;
      };
    }>;
    weekdays: Array<{
      weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
      meter: {
        total: number;
        max?: number;
        officers: number;
        officersRequired?: number;
        isFull: boolean;
      };
    }>;
  };
};

/**
 * Fetches the current A-Day board state for a given session.
 * Throws on non-2xx response.
 */
export async function fetchADayState(
  sessionId: string,
  jwt: string,
  fetcher: typeof fetch = fetch,
): Promise<ADayBoardState> {
  const res = await fetcher(`/api/bid/a-day-state?session=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`fetchADayState failed: ${res.status}`);
  }
  return (await res.json()) as ADayBoardState;
}

export type SubmitADayPickResponse =
  | { kind: 'accepted'; pick: { memberId: number; shift: string; aDay: string } }
  | ADayPickMadeMessage
  | ADayRejectMessage
  | { error: string };

/**
 * Submits a Phase 2 A-Day pick via REST (non-WS fallback).
 * Returns the parsed JSON response. Errors are still returned as JSON; the
 * caller checks the `kind`/`type` discriminant.
 */
export async function submitADayPickViaRest(
  request: SubmitADayPickRequest,
  jwt: string,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number; body: SubmitADayPickResponse }> {
  const res = await fetcher('/api/bid/a-day-pick', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(request),
  });
  const body = (await res.json()) as SubmitADayPickResponse;
  return { status: res.status, body };
}

/**
 * Classifies an incoming WS message into one of the three A-Day server-side
 * message kinds. Returns `null` if the message is not a Phase-2 event.
 */
export function classifyADayEvent(envelope: { type: string; payload?: unknown }):
  | ADayPickMadeMessage
  | ADayRejectMessage
  | PhaseChangedMessage
  | null {
  const candidate = { ...(envelope.payload as object), type: envelope.type };
  if (envelope.type === 'a_day_pick_made') {
    const parsed = ADayPickMadeMessageSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  if (envelope.type === 'a_day_reject') {
    const parsed = ADayRejectMessageSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  if (envelope.type === 'phase_changed') {
    const parsed = PhaseChangedMessageSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

/** Generates an RFC-4122 v4 idempotency key suitable for the A-Day pick request. */
export function newIdempotencyKey(): string {
  // Web Crypto first; fallback to Math.random for non-crypto contexts (tests).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Test-only fallback — not cryptographically secure.
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  const b = (i: number): number => bytes[i] ?? 0;
  // RFC-4122 §4.4 — set version (v4) and variant (10xx).
  bytes[6] = (b(6) & 0x0f) | 0x40;
  bytes[8] = (b(8) & 0x3f) | 0x80;
  return (
    `${hex(b(0))}${hex(b(1))}${hex(b(2))}${hex(b(3))}-` +
    `${hex(b(4))}${hex(b(5))}-` +
    `${hex(b(6))}${hex(b(7))}-` +
    `${hex(b(8))}${hex(b(9))}-` +
    `${hex(b(10))}${hex(b(11))}${hex(b(12))}${hex(b(13))}${hex(b(14))}${hex(b(15))}`
  );
}

/** List of all combat group ids in canonical order. */
export const COMBAT_GROUPS = ['G1', 'G2', 'G3', 'G4'] as const;
export type ADayGroupId = (typeof COMBAT_GROUPS)[number];

/** List of weekdays in ISO order. */
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Returns the set of valid A-Day candidates for a given shift. */
export function aDayCandidatesForShift(shift: 'A' | 'B' | 'C' | 'D'): readonly ADayValue[] {
  return shift === 'D' ? WEEKDAYS : COMBAT_GROUPS;
}
