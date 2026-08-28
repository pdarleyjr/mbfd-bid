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

  it('uses operator terms for current roster and TeleStaff navigation', () => {
    expect(ADMIN_NAV_LINKS).toContainEqual({
      href: '/admin/current-rosters',
      label: 'Current Rosters',
      exact: false,
    });
    expect(ADMIN_NAV_LINKS).toContainEqual({
      href: '/admin/telestaff',
      label: 'TeleStaff',
      exact: false,
    });
  });
});
