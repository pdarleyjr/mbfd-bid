import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

function source(relativePath: string) {
  return readFileSync(resolve(webRoot, relativePath), 'utf8');
}

describe('year-round admin control-center safety', () => {
  it('does not advertise a direct TeleStaff CSV import from the dashboard', () => {
    expect(source('app/admin/page.tsx')).not.toMatch(/Telestaff CSV/i);
  });

  it('keeps the advisory embedded in the authenticated authoritative Bid board', () => {
    const page = source('app/admin/bid/page.tsx');
    const panel = source('app/admin/bid/_components/BidAdvisoryPanel.tsx');

    expect(page).toContain('requireAdmin');
    expect(page).toContain('advisory={board.advisory}');
    expect(panel).toContain('Authoritative state');
    expect(panel).not.toMatch(/<(?:form|input|textarea|button)\b/i);
    expect(panel).not.toMatch(/provider|model|prompt|fallback/i);
  });

  it('keeps System/Integrations as an authenticated, non-operational landing state', () => {
    const page = source('app/admin/system/page.tsx');

    expect(page).toContain('requireAdmin');
    expect(page).toContain('data-testid="system-integrations-unavailable"');
    expect(page).not.toMatch(/<(?:form|button)\b/i);
    expect(page).not.toMatch(/serverWorkerFetch|\bfetch\(/);
  });
});
