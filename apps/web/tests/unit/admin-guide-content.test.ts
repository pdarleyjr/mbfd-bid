import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_GUIDE_COVERAGE,
  GUIDE_SECTIONS,
  filterGuideSections,
} from '../../app/admin/guide/guide-content';
import { ADMIN_NAV_LINKS } from '../../components/admin/AdminShell';

describe('Administrator Guide content contract', () => {
  it('covers every current top-level Admin navigation area', () => {
    const undocumented = ADMIN_NAV_LINKS.filter((link) => link.href !== '/admin/guide').filter(
      (link) => !ADMIN_GUIDE_COVERAGE[link.href],
    );

    expect(undocumented).toEqual([]);
  });

  it('finds the operational phrases administrators are likely to search for', () => {
    expect(filterGuideSections('TeleStaff').map((section) => section.id)).toContain('telestaff');
    expect(filterGuideSections('retire member').map((section) => section.id)).toContain(
      'personnel',
    );
    expect(filterGuideSections('change bid order').map((section) => section.id)).toContain(
      'annual-policy',
    );
    expect(filterGuideSections('specialty').map((section) => section.id)).toContain(
      'specialty-adjudication',
    );
    expect(filterGuideSections('hold presentation').map((section) => section.id)).toContain(
      'live-presentation',
    );
    expect(filterGuideSections('CSV').map((section) => section.id)).toContain('current-rosters');
  });

  it('documents the production effect and audit history of annual TeleStaff baseline replacement', () => {
    const teleStaff = GUIDE_SECTIONS.find((section) => section.id === 'telestaff');

    expect(teleStaff?.controls).toContain('Designate selected-year staffing baseline');
    expect(teleStaff?.steps.join(' ')).toContain('supersede the prior acceptance receipt');
    expect(teleStaff?.important).toContain('production D1');
    expect(teleStaff?.important).toContain('does not start a Bid session');
    expect(teleStaff?.important).toContain('does not write back to TeleStaff');
  });

  it('documents deterministic Decision Details without retaining the retired AI Assist workflow', () => {
    const advisory = GUIDE_SECTIONS.find((section) => section.id === 'bid-advisory');
    const text = `${advisory?.summary ?? ''} ${advisory?.important ?? ''}`;

    expect(advisory).toMatchObject({ route: '/admin/bid', routeLabel: 'Live Bid & Advisory' });
    expect(text).toContain('deterministic BID application rules');
    expect(text).toContain('authoritative results');
    expect(text).toContain('no AI or model generation delay');
    expect(text).toContain('do not make decisions');
    expect(text).toContain('change eligibility');
    expect(text).toContain('award positions');
    expect(text).not.toMatch(/AI Assist|Workers AI|\/admin\/ai-assist/i);
  });

  it('uses an intentional category, a real route, and concise guide content for each section', () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThanOrEqual(27);

    for (const section of GUIDE_SECTIONS) {
      expect(section.category.length).toBeGreaterThan(0);
      expect(section.route).toMatch(/^\/admin(?:\/|$)/);
      expect(existsSync(new URL(`../../app${section.route}/page.tsx`, import.meta.url))).toBe(true);
      expect(section.summary.length).toBeGreaterThan(20);
      expect(section.steps.length).toBeGreaterThan(0);
    }
  });
});
