// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Presentation, PresentationView } from '../../app/live/PresentationView';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('presentation seat colors and forced markers', () => {
  it.each([false, true])(
    'uses shared role colors and only explicit forced markers (Mock %s)',
    async (isMock) => {
      const roles = [
        ['CPT', 'Captain', 'Fire Boat 6', 'captain', '#fef08a'],
        ['LT', 'Lieutenant', 'Engine 1', 'lieutenant', '#fca5a5'],
        ['FF', 'Firefighter DE', 'Combat 1', 'driver-engineer', '#bbf7d0'],
        ['FF', 'Firefighter #1', 'Engine 1', 'engine-firefighter', '#e5e7eb'],
        ['FF', 'Firefighter #1', 'Rescue 1', 'rescue-firefighter', '#bae6fd'],
        ['FF', 'Firefighter ENG', 'Fire Boat 6', 'marine-firefighter', '#e6bb48'],
        ['FF', 'Inspector', 'Prevention', 'inspector', '#fdba74'],
      ] as const;
      const view: Presentation = {
        mode: 'LIVE',
        sequence: 10,
        session: { id: 'synthetic-seat-colors', bid_year: 2026, is_mock: isMock },
        progress: { filled: 1, total: 7 },
        positions: roles.map(([rank, name, unit], index) => ({
          id: `A10${index}`,
          shift: 'A',
          station: '1',
          unit,
          position_name: name,
          rank_required: rank,
          filled_by:
            index === 1 ? { member_id: 1, name: 'Synthetic Firefighter', rank: 'FF' } : null,
          forced: index === 1,
        })),
      };
      if (!view.positions) throw new Error('Synthetic positions required');
      view.positions.push({
        id: 'A211',
        shift: 'A',
        station: '1',
        unit: '300',
        position_name: 'Division Chief',
        rank_required: 'DC',
        filled_by: { member_id: 2, name: 'Assigned Chief', rank: 'DC' },
        assigned: true,
      });
      await act(() => root.render(<PresentationView initial={view} />));
      for (const [, , , role, color] of roles) {
        const cell = host.querySelector<HTMLElement>(`[data-seat-role="${role}"]`);
        if (!cell) throw new Error(`Missing ${role}`);
        expect(cell.style.getPropertyValue('--seat-background')).toBe(color);
        expect(cell.style.getPropertyValue('--seat-text')).toBe('#111827');
      }
      const marker = host.querySelector('[data-testid="forced-marker-A101"]');
      if (!marker) throw new Error('Forced marker missing');
      expect(marker.textContent).toBe('!');
      expect(marker.getAttribute('aria-label')).toBe('Forced assignment');
      expect(marker.getAttribute('title')).toBe('Forced assignment');
      expect(host.querySelectorAll('[data-testid^="forced-marker-"]')).toHaveLength(1);
      expect(host.querySelector('[data-position-id="A211"]')?.textContent).toContain('Assigned');
      expect(host.textContent).toContain('6 available · 1 taken');
      expect(
        host.querySelector('[data-position-id="A101"]')?.querySelector('button,a,input'),
      ).toBeNull();
    },
  );
});
