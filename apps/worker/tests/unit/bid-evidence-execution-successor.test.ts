import { prepare2026StationTwoSpecialtyWorkflow } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  bidEvidenceFreezeExecutionSettingsMatch,
  bidEvidenceFreezeSettingsMatch,
} from '../../src/lib/bid-definition-context.js';
import { stationTwoSourceDefinition } from './helpers/station-two-definition.js';

function fixture() {
  const original = stationTwoSourceDefinition();
  const prepared = prepare2026StationTwoSpecialtyWorkflow(original);
  if (!prepared.ok || !original.settings || !prepared.content.settings)
    throw new Error('Reviewed source fixture required');
  return {
    original,
    content: structuredClone(prepared.content),
    pinnedEvaluation: { capturedAtMs: 1, members: [], settings: original.settings },
  };
}

describe('saved execution successors retain sealed evidence settings', () => {
  it('allows the reviewed specialty/A-Day successor without treating its old policy as new personnel evidence', () => {
    const f = fixture();
    const settings = f.content.settings;
    if (!settings) throw new Error('Settings required');
    const before = structuredClone(f.pinnedEvaluation);
    expect(bidEvidenceFreezeSettingsMatch({ ...f, settings })).toBe(false);
    expect(bidEvidenceFreezeExecutionSettingsMatch({ ...f, settings })).toBe(true);
    expect(f.pinnedEvaluation).toEqual(before);
  });

  it('supports generic reviewed stage order, permission and A-Day changes beyond Station 2', () => {
    const f = fixture();
    if (f.content.settings?.v !== 3 || !f.content.policy) throw new Error('V3 policy required');
    const policy = f.content.settings.livePolicy;
    policy.stages = [...policy.stages].reverse().map((stage, order) => ({ ...stage, order }));
    if (!policy.annualOperations) throw new Error('Annual policy required');
    policy.annualOperations.stageOrder = policy.stages.map((stage) => stage.id);
    policy.annualOperations.aDay.max = 12;
    const permission = policy.actionPermissions[0];
    if (!permission) throw new Error('Permission required');
    permission.actorMemberIds = [91998, 91999];
    f.content.policy.executionPolicy = structuredClone(policy);
    expect(bidEvidenceFreezeExecutionSettingsMatch({ ...f, settings: f.content.settings })).toBe(
      true,
    );
  });

  it.each(['credential-date', 'personnel-date', 'cutoff', 'timer', 'duration', 'policy-mirror'])(
    'rejects an implicit change to %s',
    (kind) => {
      const f = fixture();
      if (f.content.settings?.v !== 3 || !f.content.policy) throw new Error('V3 policy required');
      const settings = f.content.settings;
      if (kind === 'credential-date') settings.credentialEvaluationOn = '2026-10-01';
      if (kind === 'personnel-date') settings.personnelEvaluationOn = '2026-10-01';
      if (kind === 'cutoff') settings.evidenceCutoffAt = '2026-10-01T17:00:00-04:00';
      if (kind === 'timer') settings.turnTimerSeconds += 1;
      if (kind === 'duration') settings.expectedDurationDays += 1;
      if (kind === 'policy-mirror')
        f.content.policy.executionPolicy = {
          ...structuredClone(f.content.policy.executionPolicy),
          policyRevision: 'unmatched',
        };
      expect(bidEvidenceFreezeExecutionSettingsMatch({ ...f, settings })).toBe(false);
    },
  );
});
