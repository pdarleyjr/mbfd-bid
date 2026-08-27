import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: 'admin-jwt' })) })),
  redirect: vi.fn(),
  requirePin: vi.fn(async () => undefined),
  verifyJwt: vi.fn(async () => ({ role: 'admin', sub: 0 })),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/require-pin', () => ({ requirePin: mocks.requirePin }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));

describe('requireAdmin', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'staging';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    mocks.cookies.mockClear();
    mocks.redirect.mockReset();
    mocks.requirePin.mockClear();
    mocks.verifyJwt.mockClear();
  });

  it('retains the PIN gate for staging admin access', async () => {
    const { requireAdmin } = await import('../../lib/require-admin');

    await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin', sub: 0 });
    expect(mocks.requirePin).toHaveBeenCalledTimes(1);
  });

  it('retains the PIN gate for non-staging admin access', async () => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'production';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    const { requireAdmin } = await import('../../lib/require-admin');

    await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin', sub: 0 });
    expect(mocks.requirePin).toHaveBeenCalledTimes(1);
  });
});
