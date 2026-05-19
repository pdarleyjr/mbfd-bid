'use client';
import { type ReactNode, createContext, useContext } from 'react';
import type { StoreApi } from 'zustand';
import type { BidStoreState } from './useBidStore';

const BidStoreContext = createContext<StoreApi<BidStoreState> | null>(null);

export function BidStoreProvider({
  store,
  children,
}: {
  store: StoreApi<BidStoreState>;
  children: ReactNode;
}) {
  return <BidStoreContext.Provider value={store}>{children}</BidStoreContext.Provider>;
}

export function useBidStoreContext(): StoreApi<BidStoreState> | null {
  return useContext(BidStoreContext);
}
