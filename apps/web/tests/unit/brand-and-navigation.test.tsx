import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BrandHeader, MBFD_MASTER_LOGO_PATH } from '../../components/BrandHeader';
import { ADMIN_NAV_LINKS } from '../../components/admin/AdminShell';

const MBFD_MASTER_LOGO_SHA256 = 'a443053e838a7699f85f11ad509703aba0024a6488e6741d3fa307141742952c';

function sha256(file: URL) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('MBFD identity and operator navigation', () => {
  it('renders the supplied MBFD master mark instead of the FD placeholder', () => {
    const html = renderToStaticMarkup(<BrandHeader subtitle="Admin Console" />);

    expect(MBFD_MASTER_LOGO_PATH).toBe('/mbfd-logo.png');
    expect(html).toContain('src="/mbfd-logo.png"');
    expect(html).toContain('alt="Miami Beach Fire Department"');
    expect(html).not.toContain('>FD<');
  });

  it('uses the exact supplied master PNG for the public and metadata-route icons', () => {
    expect(sha256(new URL('../../public/mbfd-logo.png', import.meta.url))).toBe(
      MBFD_MASTER_LOGO_SHA256,
    );
    expect(sha256(new URL('../../app/icon.png', import.meta.url))).toBe(MBFD_MASTER_LOGO_SHA256);
    expect(sha256(new URL('../../app/apple-icon.png', import.meta.url))).toBe(
      MBFD_MASTER_LOGO_SHA256,
    );
  });

  it('uses the approved year-round bid control-center sections in operator navigation', () => {
    expect(ADMIN_NAV_LINKS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/admin', label: 'Dashboard' },
      { href: '/admin/guide', label: 'Administrator Guide' },
      { href: '/admin/current-rosters', label: 'Current Rosters' },
      { href: '/admin/staffing-structure', label: 'Staffing Structure' },
      { href: '/admin/telestaff', label: 'TeleStaff' },
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/personnel', label: 'Personnel Changes' },
      { href: '/admin/bid-setup', label: 'Bid Setup' },
      { href: '/admin/ai-assist', label: 'AI Assist' },
      { href: '/admin/rehearsal', label: 'Mock Bids' },
      { href: '/admin/bid', label: 'Live Bid' },
      { href: '/admin/audit', label: 'Results & Audit' },
      { href: '/admin/system', label: 'System/Integrations' },
    ]);
  });

  it('makes the read-only award-transition review workspace discoverable from Results & Audit', () => {
    const resultsAndAudit = ADMIN_NAV_LINKS.find((link) => link.href === '/admin/audit');
    expect(resultsAndAudit?.subnav).toContainEqual({
      href: '/admin/award-transition',
      label: 'Bid Award Transition',
    });
  });

  it('makes the effective-dated qualification evidence workspace discoverable from Personnel Changes', () => {
    const personnel = ADMIN_NAV_LINKS.find((link) => link.href === '/admin/personnel');
    expect(personnel?.subnav).toContainEqual({
      href: '/admin/personnel/qualifications',
      label: 'Qualification Evidence',
    });
  });

  it('makes the credentials catalog and specialty points workspace discoverable from Members', () => {
    const members = ADMIN_NAV_LINKS.find((link) => link.href === '/admin/members');
    expect(members?.subnav).toContainEqual({
      href: '/admin/credentials',
      label: 'Credentials & Specialty Points',
    });
  });
});
