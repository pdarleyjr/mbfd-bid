import { describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));

describe('POST /api/auth/logout', () => {
  it('expires both the JWT and PIN cookies', async () => {
    const { POST } = await import('../../app/api/auth/logout/route');

    const response = await POST();

    expect(response.status).toBe(204);
    expect(cookieSet).toHaveBeenCalledWith(
      'mbfd_bid_jwt',
      '',
      expect.objectContaining({ httpOnly: true, path: '/', maxAge: 0 }),
    );
    expect(cookieSet).toHaveBeenCalledWith(
      'mbfd_pin',
      '',
      expect.objectContaining({ httpOnly: true, path: '/', maxAge: 0 }),
    );
  });
});
