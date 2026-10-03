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

type PositionIntent = { memberId: number; positionId: string; nonce: number };
type OverrideIntent = { memberId: number; positionId?: string; deferADay?: boolean; nonce: number };
interface OperatorContext {
  selectedMemberId: number | null;
  activeMemberId: number | null;
  selectMember: (id: number) => void;
  setActiveMember: (id: number | null) => void;
  positionIntent: PositionIntent | null;
  choosePosition: (positionId: string) => void;
  overrideIntent: OverrideIntent | null;
  requestOverride: (positionId?: string, memberId?: number, deferADay?: boolean) => void;
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
      overrideAllowed,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBidOperator() {
  return useContext(Context);
}
