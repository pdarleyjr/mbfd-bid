import { describe, expect, it } from 'vitest';
import { buildCorrected2026DraftRules } from '../../src/lib/corrected-2026-draft-rules.js';
import {
  POLICY_2026_CREDENTIALS,
  POLICY_2026_EXISTING_CREDENTIAL_BINDINGS,
} from '../../src/lib/policy-2026-credentials.js';

describe('2026 policy credential catalog identities', () => {
  it('reuses issuer-specific catalog identities and adds only strict new definitions', () => {
    const names = POLICY_2026_CREDENTIALS.map((entry) => entry.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Valid OUPV / Six Pack Authority');
    expect(names).toContain('Passing IADRS Watermanship Test');
    const bindings = new Map(
      POLICY_2026_EXISTING_CREDENTIAL_BINDINGS.map((entry) => [entry.term, entry.name]),
    );
    expect(bindings.get('NFPA 1123')).toBe('NFPA1123 Outdoor Fireworks');
    expect(bindings.get('RN 8313')).toBe('Crowd Manager Certificate (RN8313)');
    expect(bindings.get('DRI Public Safety Diver')).toBe('DRI Public Safety Diver');
    expect(bindings.get('PADI Public Safety Diver')).toBe('PADI Public Safety Diver');
    const rules = buildCorrected2026DraftRules().rules;
    const marine = rules.find((rule) => rule.positionId === 'A601');
    expect(marine?.requiredCriteria.credentials).toEqual(
      expect.arrayContaining([
        'Valid OUPV / Six Pack Authority',
        'Passing IADRS Watermanship Test',
      ]),
    );
    expect(marine?.requiredCriteria.credentials).not.toContain('IADRS Swim Evaluation');
    expect(
      marine?.pointsPreference.scoring?.total.some((group) =>
        group.items.some(
          (item) =>
            item.credential === 'DRI Public Safety Diver' &&
            item.alternatives.includes('PADI Public Safety Diver'),
        ),
      ),
    ).toBe(true);
    expect(
      rules.some((rule) =>
        rule.pointsPreference.scoring?.total.some((group) =>
          group.items.some((item) => item.credential === 'NFPA1123 Outdoor Fireworks'),
        ),
      ),
    ).toBe(true);
  });
});
