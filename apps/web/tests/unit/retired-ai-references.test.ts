import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const adminDashboard = readFileSync(resolve(webRoot, 'app/admin/page.tsx'), 'utf8');
const bidSocketHook = readFileSync(resolve(webRoot, 'app/bid/_hooks/useBidWebSocket.ts'), 'utf8');

describe('retired AI references', () => {
  it('does not advertise retired AI advisory controls in the active admin dashboard', () => {
    expect(adminDashboard).not.toMatch(/AI advis(?:or(?:y|ies)|ories)/i);
  });

  it('does not invalidate a query for a retired AI endpoint after bid events', () => {
    expect(bidSocketHook).not.toContain('ai-advise-current');
  });
});
