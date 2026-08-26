import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_READINESS_CHECK_IDS,
  type LiveReadinessCheck,
  evaluateLiveReadiness,
} from '../src/index.js';

function allReady(): LiveReadinessCheck[] {
  return DEFAULT_LIVE_READINESS_CHECK_IDS.map((id) => ({ id, status: 'READY' }));
}

describe('evaluateLiveReadiness', () => {
  it('permits a live start only when every required fact is ready', () => {
    const result = evaluateLiveReadiness({ checks: allReady() });

    expect(result.overallStatus).toBe('READY');
    expect(result.canStartLiveBid).toBe(true);
    expect(result.blockingCheckIds).toEqual([]);
  });

  it('keeps warnings visible without treating them as an implicit start block', () => {
    const checks = allReady();
    const firstCheck = checks[0];
    if (firstCheck === undefined) throw new Error('expected a required readiness check');
    checks[0] = { id: firstCheck.id, status: 'WARNING', detail: 'Review before live operation.' };

    const result = evaluateLiveReadiness({ checks });

    expect(result.overallStatus).toBe('WARNING');
    expect(result.canStartLiveBid).toBe(true);
    expect(result.blockingCheckIds).toEqual([]);
  });

  it('fails closed when an explicit fact is blocking', () => {
    const checks = allReady();
    checks[2] = { id: 'policy', status: 'BLOCKING', detail: 'Policy conflicts remain.' };

    const result = evaluateLiveReadiness({ checks });

    expect(result.overallStatus).toBe('BLOCKING');
    expect(result.canStartLiveBid).toBe(false);
    expect(result.blockingCheckIds).toEqual(['policy']);
  });

  it('fails closed when a required fact is not configured', () => {
    const checks = allReady();
    checks[15] = { id: 'portal', status: 'NOT_CONFIGURED' };

    const result = evaluateLiveReadiness({ checks });

    expect(result.overallStatus).toBe('NOT_CONFIGURED');
    expect(result.canStartLiveBid).toBe(false);
    expect(result.blockingCheckIds).toEqual(['portal']);
  });

  it('turns absent required facts into explicit not-configured blockers', () => {
    const result = evaluateLiveReadiness({
      checks: allReady().filter((check) => check.id !== 'a_day'),
    });

    expect(result.canStartLiveBid).toBe(false);
    expect(result.overallStatus).toBe('NOT_CONFIGURED');
    expect(result.blockingCheckIds).toEqual(['a_day']);
    expect(result.checks).toContainEqual({
      id: 'a_day',
      status: 'NOT_CONFIGURED',
      detail: 'No readiness fact was supplied.',
    });
  });

  it('fails closed when duplicate facts make a required status ambiguous', () => {
    const result = evaluateLiveReadiness({
      checks: [...allReady(), { id: 'policy', status: 'READY' }],
    });

    expect(result.canStartLiveBid).toBe(false);
    expect(result.overallStatus).toBe('BLOCKING');
    expect(result.blockingCheckIds).toEqual(['duplicate:policy']);
  });

  it('fails closed when an untrusted provider supplies an unknown status', () => {
    const checks = allReady();
    checks[0] = { id: 'current_assignments', status: 'STALE' as LiveReadinessCheck['status'] };

    const result = evaluateLiveReadiness({ checks });

    expect(result.canStartLiveBid).toBe(false);
    expect(result.overallStatus).toBe('BLOCKING');
    expect(result.blockingCheckIds).toEqual(['current_assignments']);
    expect(result.checks).toContainEqual({
      id: 'current_assignments',
      status: 'BLOCKING',
      detail: 'Readiness fact has an unsupported status value.',
    });
  });
});
