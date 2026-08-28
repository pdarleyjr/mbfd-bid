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

  it.each([
    ['AI Assist', 'app/admin/ai-assist/page.tsx', 'ai-assist-unavailable'],
    ['System/Integrations', 'app/admin/system/page.tsx', 'system-integrations-unavailable'],
  ])('%s is an authenticated, non-operational landing state', (_label, relativePath, testId) => {
    const page = source(relativePath);

    expect(page).toContain('requireAdmin');
    expect(page).toContain(`data-testid="${testId}"`);
    expect(page).not.toMatch(/<(?:form|button)\b/i);
    expect(page).not.toMatch(/serverWorkerFetch|\bfetch\(/);
  });
});
