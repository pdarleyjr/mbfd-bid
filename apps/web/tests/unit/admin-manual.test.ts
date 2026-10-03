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
    expect(html).toContain('Confirm Real Bid creation');
    expect(html).toContain('Results and History are read-only');
    expect(html).toContain('Save Bid checks and applies those profile changes');
    expect(html).toContain('voluntary departure consent');
  });
  it('selects specific page help rather than matching the entire admin area', () => {
    expect(helpForPath('/admin/personnel/qualifications').map((s) => s.id)).toEqual([
      'qualification-evidence',
    ]);
    expect(helpForPath('/admin/members/12/edit').some((s) => s.id === 'members')).toBe(true);
    expect(helpForPath('/admin/bid').some((s) => s.id === 'live-presentation')).toBe(true);
  });
});

it('preserves the explicitly historical PDF and its exact source provenance', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../public/manual/manifest.json', import.meta.url), 'utf8'),
  );
  const hash = (path: string) =>
    createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');
  expect(manifest.edition).toBe('historical');
  expect(manifest.sourceDate).toBe('2026-10-03');
  expect(manifest.sourceCommit).toBe('00cb7515b6e3dd5acbfb6a1a2c484f8d5d491b70');
  expect(manifest.sourceSha256).toBe(
    '5b50cd48266260d8ae9c0bbd8c7f9f033b854c7cc07cac060d0ffd86008ec4e6',
  );
  expect(hash('../../app/admin/guide/guide-content.ts')).not.toBe(manifest.sourceSha256);
  expect(hash('../../public/manual/MBFD-Bid-Administrator-Manual.pdf')).toBe(manifest.pdfSha256);
});
