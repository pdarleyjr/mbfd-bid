import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LegacyMemberImportRetiredPanel } from '../../app/admin/members/import/RetiredMemberImportPanel';

describe('legacy member write retirement UI', () => {
  it('directs a former member-import operator to controlled TeleStaff and personnel workflows', () => {
    const html = renderToString(<LegacyMemberImportRetiredPanel />);

    expect(html).toContain('Legacy member import retired');
    expect(html).toContain('does not upload or alter member records');
    expect(html).toContain('/admin/telestaff');
    expect(html).toContain('/admin/personnel');
    expect(html).not.toContain('input type="file"');
  });

  it('keeps the master roster read-only for credentials and removes legacy bootstrap calls', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/admin/members/roster/RosterClient.tsx'),
      'utf8',
    );

    expect(source).not.toContain('/api/admin/members/seed-from-synthesis');
    expect(source).not.toContain('/credentials/${credentialId}');
    expect(source).toContain("'/admin/telestaff'");
    expect(source).toContain("'/admin/personnel'");
    expect(source).toContain('read-only credential evidence');
  });

  it('retires the legacy upload proxy before it parses an upload or contacts the worker', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/api/admin/members-import/route.ts'),
      'utf8',
    );

    expect(source).toContain('status: 410');
    expect(source).not.toContain('req.formData');
    expect(source).not.toContain('getWorkerBase');
    expect(source).not.toContain('fetch(');
  });
});
