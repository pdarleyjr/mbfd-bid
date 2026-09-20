'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type RosterGroup,
  type RosterMeasurements,
  type RosterPage,
  paginateRoster,
} from './roster-pagination';

const GAP = 12;
const MIN_COLUMN_WIDTH = 340;

type MeasuredLayout = {
  pages: RosterPage[];
  oversizedPositionIds: string[];
  compactPositionIds: string[];
};

export function useRosterLayout(groups: RosterGroup[]) {
  const rosterRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 0, height: 0, desktop: false, ready: false });
  const [columnLimit, setColumnLimit] = useState<{
    groups: RosterGroup[];
    width: number;
    height: number;
    columns: number;
  } | null>(null);
  const preferredColumns = Math.max(1, Math.floor((geometry.width + GAP) / MIN_COLUMN_WIDTH));
  const columns =
    columnLimit?.groups === groups &&
    columnLimit.width === geometry.width &&
    columnLimit.height === geometry.height
      ? Math.min(preferredColumns, columnLimit.columns)
      : preferredColumns;
  const columnWidth = Math.max(1, (geometry.width - GAP * (columns - 1)) / columns);
  const [measured, setMeasured] = useState<{
    groups: RosterGroup[];
    width: number;
    values: RosterMeasurements;
  } | null>(null);

  useLayoutEffect(() => {
    const element = rosterRef.current;
    if (!element) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      const next = {
        width: bounds.width,
        height: desktop.matches ? bounds.height : 0,
        desktop: desktop.matches,
        ready: true,
      };
      setGeometry((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.desktop === next.desktop &&
        current.ready
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    desktop.addEventListener('change', resize);
    resize();
    return () => {
      observer.disconnect();
      desktop.removeEventListener('change', resize);
    };
  }, []);

  useLayoutEffect(() => {
    const element = measurementRef.current;
    if (!element || !geometry.desktop || !geometry.ready || geometry.width === 0) return;
    const read = () => {
      const headings: Record<string, number> = {};
      const rows: Record<string, number> = {};
      const compactRows: Record<string, number> = {};
      for (const heading of element.querySelectorAll<HTMLElement>('[data-measure-heading]')) {
        const id = heading.dataset.measureHeading;
        if (id !== undefined) headings[id] = Math.ceil(heading.getBoundingClientRect().height);
      }
      for (const row of element.querySelectorAll<HTMLElement>('[data-measure-row]')) {
        const id = row.dataset.measureRow;
        if (id !== undefined) rows[id] = Math.ceil(row.getBoundingClientRect().height);
      }
      for (const row of element.querySelectorAll<HTMLElement>('[data-measure-compact-row]')) {
        const id = row.dataset.measureCompactRow;
        if (id !== undefined) compactRows[id] = Math.ceil(row.getBoundingClientRect().height);
      }
      setMeasured((current) => {
        const values = { headings, rows, compactRows };
        return current?.groups === groups &&
          current.width === columnWidth &&
          JSON.stringify(current.values) === JSON.stringify(values)
          ? current
          : { groups, width: columnWidth, values };
      });
    };
    const observer = new ResizeObserver(read);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    read();
    let disposed = false;
    void document.fonts.ready.then(() => {
      if (!disposed) read();
    });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [groups, columnWidth, geometry.desktop, geometry.ready, geometry.width]);

  const layout = useMemo<MeasuredLayout>(() => {
    const empty = { pages: [], oversizedPositionIds: [], compactPositionIds: [] };
    if (!geometry.ready) return empty;
    if (!geometry.desktop) {
      return {
        pages: groups.length
          ? [[groups.map((group) => ({ group, positions: group.positions, height: 0 }))]]
          : [],
        oversizedPositionIds: [],
        compactPositionIds: [],
      };
    }
    if (measured?.groups !== groups || measured.width !== columnWidth) {
      return empty;
    }
    const availableHeight = Math.max(0, Math.floor(geometry.height) - 2);
    const full = paginateRoster(groups, measured.values, availableHeight, columns);
    if (columns > 1 || full.oversizedPositionIds.length === 0) {
      return { ...full, compactPositionIds: [] };
    }
    const compactPositionIds = groups.flatMap((group) =>
      group.positions
        .filter(
          (position) =>
            full.oversizedPositionIds.includes(position.id) && position.temporaryContext.length > 0,
        )
        .map((position) => position.id),
    );
    const rows = { ...measured.values.rows };
    for (const id of compactPositionIds) {
      const height = measured.values.compactRows?.[id];
      if (height === undefined) return empty;
      rows[id] = height;
    }
    return {
      ...paginateRoster(groups, { ...measured.values, rows }, availableHeight, columns),
      compactPositionIds,
    };
  }, [groups, measured, columnWidth, columns, geometry]);

  const requiresWiderColumn =
    geometry.desktop && columns > 1 && layout.oversizedPositionIds.length > 0;
  useLayoutEffect(() => {
    if (!requiresWiderColumn) return;
    setColumnLimit({
      groups,
      width: geometry.width,
      height: geometry.height,
      columns: columns - 1,
    });
  }, [requiresWiderColumn, groups, geometry.width, geometry.height, columns]);

  return {
    ...layout,
    rosterRef,
    measurementRef,
    geometry,
    columns,
    columnWidth,
    ready:
      geometry.ready && !requiresWiderColumn && (groups.length === 0 || layout.pages.length > 0),
  };
}
