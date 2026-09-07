import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS } from '../../app/admin/guide/guide-content';
import { buildAdministratorManual, helpForPath } from '../../lib/admin-manual';

describe('administrator manual and contextual explanations', () => {
  it('includes every topic, instruction and control in a portable complete manual', () => {
    const html = buildAdministratorManual();
    for (const section of GUIDE_SECTIONS) {
      expect(html).toContain(`id="${section.id}"`);
      expect(html).toContain(section.title.replaceAll('&', '&amp;'));
    }
    expect(html).toContain('window.print()');
    expect(html).not.toContain('src="http');
  });
  it('selects specific page help rather than matching the entire admin area', () => {
    expect(helpForPath('/admin/personnel/qualifications').map((s) => s.id)).toEqual([
      'qualification-evidence',
    ]);
    expect(helpForPath('/admin/members/12/edit').some((s) => s.id === 'members')).toBe(true);
    expect(helpForPath('/admin/bid').some((s) => s.id === 'live-presentation')).toBe(true);
  });
});

it('keeps the downloadable PDF synchronized with the live guide', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../public/manual/manifest.json', import.meta.url), 'utf8'),
  );
  const hash = (path: string) =>
    createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');
  expect(hash('../../app/admin/guide/guide-content.ts')).toBe(manifest.sourceSha256);
  expect(hash('../../public/manual/MBFD-Bid-Administrator-Manual.pdf')).toBe(manifest.pdfSha256);
});
