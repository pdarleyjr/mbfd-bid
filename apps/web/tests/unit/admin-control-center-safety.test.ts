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

  it('keeps AI Assist authenticated while delegating only to the advisory workspace', () => {
    const page = source('app/admin/ai-assist/page.tsx');
    const workspace = source('app/admin/ai-assist/AiAssistWorkspace.tsx');

    expect(page).toContain('requireAdmin');
    expect(page).toContain('AiAssistWorkspace');
    expect(page).not.toMatch(/<(?:form|button)\b/i);
    expect(page).not.toMatch(/serverWorkerFetch|\bfetch\(/);
    expect(workspace).toContain('mayCommitBid: false');
    expect(workspace).toContain('mayMutatePolicy: false');
    expect(workspace).toContain('mayMutateAssignments: false');
    expect(workspace).toContain('Cloudflare Workers AI');
    expect(workspace).toContain('providerAvailable');
    expect(workspace).toContain('Deterministic fallback — provider unavailable');
  });

  it('keeps System/Integrations as an authenticated, non-operational landing state', () => {
    const page = source('app/admin/system/page.tsx');

    expect(page).toContain('requireAdmin');
    expect(page).toContain('data-testid="system-integrations-unavailable"');
    expect(page).not.toMatch(/<(?:form|button)\b/i);
    expect(page).not.toMatch(/serverWorkerFetch|\bfetch\(/);
  });
});
