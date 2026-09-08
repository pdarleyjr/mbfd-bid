'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function useListPage<T>(rows: T[], selection: string, size = 8) {
  const [cursor, setCursor] = useState({ selection, page: 0 });
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = cursor.selection === selection ? Math.min(cursor.page, pages - 1) : 0;
  return {
    rows: rows.slice(page * size, (page + 1) * size),
    page,
    pages,
    total: rows.length,
    size,
    setPage: (next: number) =>
      setCursor({ selection, page: Math.max(0, Math.min(next, pages - 1)) }),
  };
}

export function ListPagination({
  page,
  pages,
  total,
  size,
  setPage,
  label = 'records',
}: {
  page: number;
  pages: number;
  total: number;
  size: number;
  setPage: (page: number) => void;
  label?: string;
}) {
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"
    >
      <output className="text-muted-foreground">
        {total ? `${page * size + 1}–${Math.min((page + 1) * size, total)}` : '0'} of {total}{' '}
        {label}
      </output>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span className="tabular-nums">
          {page + 1} / {pages}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
