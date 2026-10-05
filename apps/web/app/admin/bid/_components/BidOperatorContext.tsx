'use client';

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
import type { OperatorADayProjection } from './operator-a-day-board';
import type { OperatorSpecialtyRoster } from './operator-specialty-roster';

type PositionIntent = { memberId: number; positionId: string; nonce: number };
type OverrideIntent = {
  memberId: number;
  positionId?: string;
  deferADay?: boolean;
  aDay?: string;
  action?: 'AWARD' | 'A_DAY';
  shift?: string;
  nonce: number;
};
interface OperatorContext {
  selectedMemberId: number | null;
  activeMemberId: number | null;
  selectMember: (id: number) => void;
  setActiveMember: (id: number | null) => void;
  positionIntent: PositionIntent | null;
  choosePosition: (positionId: string) => void;
  overrideIntent: OverrideIntent | null;
  requestOverride: (positionId?: string, memberId?: number, deferADay?: boolean) => void;
  requestADay: (aDay: string, memberId?: number, positionId?: string, shift?: string) => void;
  aDayProjection: OperatorADayProjection | null;
  setADayProjection: (projection: OperatorADayProjection | null) => void;
  specialtyRoster: OperatorSpecialtyRoster | null;
  setSpecialtyRoster: (projection: OperatorSpecialtyRoster | null) => void;
  boardSequence: number;
  observeBoardSequence: (sequence: number) => void;
  overrideAllowed: boolean;
  setOverrideAllowed: (allowed: boolean) => void;
}
const Context = createContext<OperatorContext | null>(null);

export function BidOperatorProvider({
  currentBidderId,
  children,
}: { currentBidderId: number | null; children: ReactNode }) {
  const [selectedMemberId, setSelectedMemberId] = useState(currentBidderId);
  const [activeMemberId, setActiveMemberId] = useState(currentBidderId);
  const activeMemberRef = useRef(currentBidderId);
  const [positionIntent, setPositionIntent] = useState<PositionIntent | null>(null);
  const [overrideIntent, setOverrideIntent] = useState<OverrideIntent | null>(null);
  const [overrideAllowed, setOverrideAllowed] = useState(false);
  const [aDayProjection, setADayProjection] = useState<OperatorADayProjection | null>(null);
  const [specialtyRoster, setSpecialtyRoster] = useState<OperatorSpecialtyRoster | null>(null);
  const [boardSequence, setBoardSequence] = useState(0);
  const observeBoardSequence = useCallback(
    (sequence: number) => setBoardSequence((current) => Math.max(current, sequence)),
    [],
  );
  const selectMember = useCallback((id: number) => setSelectedMemberId(id), []);
  const setActiveMember = useCallback((id: number | null) => {
    const previous = activeMemberRef.current;
    activeMemberRef.current = id;
    setActiveMemberId(id);
    if (previous !== id) setSelectedMemberId((selected) => (selected === previous ? id : selected));
  }, []);
  useEffect(() => setActiveMember(currentBidderId), [currentBidderId, setActiveMember]);
  const choosePosition = useCallback(
    (positionId: string) => {
      if (selectedMemberId === null) return;
      setPositionIntent((previous) => ({
        memberId: selectedMemberId,
        positionId,
        nonce: (previous?.nonce ?? 0) + 1,
      }));
    },
    [selectedMemberId],
  );
  const requestOverride = useCallback(
    (positionId?: string, memberId?: number, deferADay?: boolean) => {
      const targetMemberId = memberId ?? selectedMemberId;
      if (targetMemberId === null) return;
      setOverrideIntent((previous) => ({
        memberId: targetMemberId,
        ...(positionId ? { positionId } : {}),
        ...(deferADay ? { deferADay } : {}),
        nonce: (previous?.nonce ?? 0) + 1,
      }));
    },
    [selectedMemberId],
  );
  const requestADay = useCallback(
    (aDay: string, memberId?: number, positionId?: string, shift?: string) => {
      const targetMemberId = memberId ?? selectedMemberId;
      if (targetMemberId === null) return;
      setOverrideIntent((previous) => ({
        memberId: targetMemberId,
        aDay,
        action: positionId ? 'A_DAY' : 'AWARD',
        ...(positionId ? { positionId } : {}),
        ...(shift ? { shift } : {}),
        nonce: (previous?.nonce ?? 0) + 1,
      }));
    },
    [selectedMemberId],
  );
  const value = useMemo(
    () => ({
      selectedMemberId,
      activeMemberId,
      selectMember,
      setActiveMember,
      positionIntent,
      choosePosition,
      overrideIntent,
      requestOverride,
      requestADay,
      aDayProjection,
      setADayProjection,
      specialtyRoster,
      setSpecialtyRoster,
      boardSequence,
      observeBoardSequence,
      overrideAllowed,
      setOverrideAllowed,
    }),
    [
      selectedMemberId,
      activeMemberId,
      selectMember,
      setActiveMember,
      positionIntent,
      choosePosition,
      overrideIntent,
      requestOverride,
      requestADay,
      aDayProjection,
      specialtyRoster,
      boardSequence,
      observeBoardSequence,
      overrideAllowed,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBidOperator() {
  return useContext(Context);
}
