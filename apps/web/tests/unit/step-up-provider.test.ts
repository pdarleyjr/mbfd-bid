import { describe, expect, it } from 'vitest';

import { stepUpAuthenticationPath } from '../../app/admin/_components/StepUpProvider';

describe('step-up authentication return path', () => {
  it('returns an administrator to the exact page that required fresh authentication', () => {
    expect(stepUpAuthenticationPath('/admin/telestaff', '?review=2')).toBe(
      '/api/auth/start?returnTo=%2Fadmin%2Ftelestaff%3Freview%3D2',
    );
  });
});
