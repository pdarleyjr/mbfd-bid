import { describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';

describe('legacy normal-human password login removal', () => {
  it('does not expose the retired /api/auth/login endpoint', async () => {
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employee_id: '20731', password: 'not-forwarded' }),
    });
    expect(response.status).toBe(404);
  });
});
