'use client';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const KEY = 'mbfd-admin-bid-year';
const YEAR_ROUTES = [
  '/admin/annual-plan',
  '/admin/source-review',
  '/admin/annual-policy',
  '/admin/bid-setup',
  '/admin/bid-board',
];
const valid = (year: number) => Number.isInteger(year) && year >= 2024 && year <= 2100;

/** Only remembers a navigation preference. Never supplies an authoritative policy date. */
export function BidYearContext() {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const selected = Number(params.get('year'));
  useEffect(() => {
    try {
      if (valid(selected)) window.localStorage.setItem(KEY, String(selected));
      else if (YEAR_ROUTES.includes(path)) {
        const remembered = Number(window.localStorage.getItem(KEY));
        const next = new URLSearchParams(params.toString());
        next.set('year', String(valid(remembered) ? remembered : new Date().getFullYear()));
        router.replace(`${path}?${next}` as Route);
      }
    } catch {
      /* Navigation remains functional when browser storage is unavailable. */
    }
  }, [path, params, selected, router]);
  if (!YEAR_ROUTES.includes(path)) return null;
  return (
    <p className="mb-3 text-sm text-muted-foreground">
      Annual Bid context: <strong>{valid(selected) ? selected : 'Loading selected year…'}</strong>.
      Qualification cutoff and assignment effective dates are reviewed separately in the annual
      setup.
    </p>
  );
}
