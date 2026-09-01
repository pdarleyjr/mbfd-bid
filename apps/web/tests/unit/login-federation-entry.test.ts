import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  redirect: vi.fn(),
  requirePin: vi.fn(),
  verifyJwt: vi.fn(),
}));

vi.mock('@/components/BrandHeader', () => ({ BrandHeader: () => null }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));
vi.mock('@/lib/require-pin', () => ({ requirePin: mocks.requirePin }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('/login canonical federation entry', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.cfEnv.mockReset();
    mocks.cookies.mockClear();
    mocks.redirect.mockReset();
    mocks.requirePin.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.cfEnv.mockImplementation((key: string) => (key === 'ENV' ? 'staging' : undefined));
    mocks.cookies.mockResolvedValue({ get: vi.fn() });
  });

  it('does not require a legacy PIN before starting canonical Hub sign-in', async () => {
    const { default: LoginPage } = await import('../../app/(auth)/login/page');

    await LoginPage({ searchParams: Promise.resolve({}) });

    expect(mocks.requirePin).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith('/api/auth/start');
  });
});
