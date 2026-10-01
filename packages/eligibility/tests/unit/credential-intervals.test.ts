import { describe, expect, it } from 'vitest';
import { requiredCredsSatisfied } from '../../src/criteria/certs.js';
import type { Credential, EligibilityReason, Member } from '../../src/types.js';

const AWARENESS = 'Hazardous Materials Awareness';
const OPERATIONS = 'Hazardous Materials Operations';
const EVALUATION_ON = '2026-09-30';
const currentAwareness: Credential = {
  name: AWARENESS,
  status: 'active',
  effectiveOn: '2026-01-01',
  expiresOn: '2026-12-31',
};
const currentOperations: Credential = { ...currentAwareness, name: OPERATIONS };
const expiredAwareness: Credential = { ...currentAwareness, expiresOn: '2026-09-29' };
const expiredOperations: Credential = { ...expiredAwareness, name: OPERATIONS };
const futureAwareness: Credential = { ...currentAwareness, effectiveOn: '2026-10-01' };

function memberWith(credentials: Credential[]): Member {
  return {
    employeeId: 'synthetic-credential-intervals',
    firstName: 'Synthetic',
    lastName: 'Member',
    rank: 'FF',
    rscSeniority: 1,
    rankSeniority: 1,
    isProbationary: false,
    credentials,
    scoringEvidence: { evaluationOn: EVALUATION_ON, completedCredentialNames: [] },
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => other !== index)).map((rest) => [value, ...rest]),
  );
}

const exactReason: EligibilityReason = {
  code: 'CRED_OK',
  label: `Holds current required: ${AWARENESS} (effective on 2026-01-01, expires on 2026-12-31)`,
  satisfied: true,
};
const equivalentReason: EligibilityReason = {
  code: 'CRED_EQUIVALENT',
  label: `Holds ${OPERATIONS}, which satisfies the 2026 ${AWARENESS} minimum (effective on 2026-01-01, expires on 2026-12-31)`,
  satisfied: true,
};

const cases: { label: string; rows: Credential[]; expected: EligibilityReason }[] = [
  {
    label: 'expired exact evidence followed by a current approved equivalent',
    rows: [expiredAwareness, currentOperations],
    expected: equivalentReason,
  },
  {
    label: 'current exact evidence and an expired approved equivalent',
    rows: [currentAwareness, expiredOperations],
    expected: exactReason,
  },
  {
    label: 'future renewal and a current interval for the same credential',
    rows: [futureAwareness, currentAwareness],
    expected: exactReason,
  },
  {
    label: 'expired, current and future intervals for the same credential',
    rows: [expiredAwareness, currentAwareness, futureAwareness],
    expected: exactReason,
  },
  {
    label: 'valid exact evidence takes explanatory preference over a valid equivalent',
    rows: [currentOperations, currentAwareness],
    expected: exactReason,
  },
  {
    label: 'revoked exact evidence does not suppress a current equivalent',
    rows: [{ ...currentAwareness, status: 'revoked' }, currentOperations],
    expected: equivalentReason,
  },
  {
    label: 'removed and expired-status rows do not suppress a current interval',
    rows: [
      { ...currentAwareness, status: 'removed' },
      { ...currentAwareness, status: 'expired' },
      currentAwareness,
    ],
    expected: exactReason,
  },
  {
    label: 'multiple valid exact rows select the latest effective interval consistently',
    rows: [currentAwareness, { ...currentAwareness, effectiveOn: '2026-09-01' }],
    expected: {
      ...exactReason,
      label: `Holds current required: ${AWARENESS} (effective on 2026-09-01, expires on 2026-12-31)`,
    },
  },
  {
    label: 'a future active interval is not current evidence',
    rows: [futureAwareness],
    expected: {
      code: 'CRED_NOT_YET_EFFECTIVE',
      label: `Required credential is not effective on ${EVALUATION_ON}: ${AWARENESS}`,
      satisfied: false,
    },
  },
  {
    label: 'all expired matching intervals fail consistently',
    rows: [expiredAwareness, expiredOperations],
    expected: {
      code: 'CRED_EXPIRED',
      label: `Required credential expired before ${EVALUATION_ON}: ${AWARENESS}`,
      satisfied: false,
    },
  },
  {
    label: 'no current interval gives the same future-renewal explanation in every order',
    rows: [expiredAwareness, futureAwareness],
    expected: {
      code: 'CRED_NOT_YET_EFFECTIVE',
      label: `Required credential is not effective on ${EVALUATION_ON}: ${AWARENESS}`,
      satisfied: false,
    },
  },
  {
    label: 'no matching evidence remains missing',
    rows: [{ name: 'Rope Rescue Operations' }],
    expected: {
      code: 'CRED_MISSING',
      label: `Missing required: ${AWARENESS}`,
      satisfied: false,
    },
  },
];

describe('required credential interval authority', () => {
  it.each(cases)('$label is independent of evidence array order', ({ rows, expected }) => {
    for (const credentials of permutations(rows)) {
      const member = memberWith(credentials);
      const before = JSON.stringify(member);
      expect(requiredCredsSatisfied(member, [AWARENESS])).toEqual([expected]);
      expect(JSON.stringify(member)).toBe(before);
    }
  });

  it('includes both effective and expiration calendar-day boundaries', () => {
    const credential = {
      ...currentAwareness,
      effectiveOn: EVALUATION_ON,
      expiresOn: EVALUATION_ON,
    };
    expect(requiredCredsSatisfied(memberWith([credential]), [AWARENESS])).toEqual([
      {
        code: 'CRED_OK',
        label: `Holds current required: ${AWARENESS} (effective on ${EVALUATION_ON}, expires on ${EVALUATION_ON})`,
        satisfied: true,
      },
    ]);
  });

  it.each(['expired', 'revoked', 'removed', 'inactive'])(
    'rejects %s lifecycle evidence',
    (status) => {
      const credential = { ...currentAwareness, status } as Credential;
      expect(requiredCredsSatisfied(memberWith([credential]), [AWARENESS])).toEqual([
        {
          code: `CRED_${status.toUpperCase()}`,
          label: `Required credential is ${status}: ${AWARENESS}`,
          satisfied: false,
        },
      ]);
    },
  );

  it('retains legacy undated exact evidence without inventing interval dates', () => {
    expect(requiredCredsSatisfied(memberWith([{ name: AWARENESS }]), [AWARENESS])).toEqual([
      { code: 'CRED_OK', label: `Holds current required: ${AWARENESS}`, satisfied: true },
    ]);
  });

  it('describes only the interval dates actually recorded', () => {
    expect(
      requiredCredsSatisfied(memberWith([{ name: AWARENESS, effectiveOn: '2026-01-01' }]), [
        AWARENESS,
      ]),
    ).toEqual([
      {
        code: 'CRED_OK',
        label: `Holds current required: ${AWARENESS} (effective on 2026-01-01)`,
        satisfied: true,
      },
    ]);
  });

  it.each(['Hazardous Materials Awareness', 'HazMat Awareness', 'Hazmat Awareness Level'])(
    'preserves the existing approved Operations-to-%s minimum only',
    (required) => {
      expect(requiredCredsSatisfied(memberWith([currentOperations]), [required])[0]).toMatchObject({
        code: 'CRED_EQUIVALENT',
        satisfied: true,
      });
    },
  );

  it.each([
    [AWARENESS, OPERATIONS],
    ['HazMat Operations', AWARENESS],
    ['Rope Rescue Operations', 'Rope Rescue Awareness'],
  ])('does not invent an equivalency from %s to %s', (held, required) => {
    expect(requiredCredsSatisfied(memberWith([{ name: held }]), [required])[0]).toMatchObject({
      code: 'CRED_MISSING',
      satisfied: false,
    });
  });
});
