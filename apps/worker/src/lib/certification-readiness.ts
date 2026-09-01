export type CertificationReadinessClassification =
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | 'MISSING'
  | 'VALID_NO_EXPIRATION'
  | 'VALID'
  | 'CONFLICT';

export interface CertificationReadinessSourceRow {
  memberId: number;
  memberName: string;
  rank: string;
  credential: string | null;
  specialty: string | null;
  status: 'active' | 'expired' | 'revoked' | 'removed';
  effectiveOn: string | null;
  expiresOn: string | null;
  evidenceSource: string | null;
  evidenceReference: string | null;
  changedAt: string | null;
}

export function classifyCertificationReadiness(input: {
  asOf: string;
  expiringSoonDays: number;
  annualEvaluationOn: string | null;
  rows: CertificationReadinessSourceRow[];
}) {
  const soon = new Date(`${input.asOf}T00:00:00.000Z`);
  soon.setUTCDate(soon.getUTCDate() + input.expiringSoonDays);
  const soonOn = soon.toISOString().slice(0, 10);
  const recentlyChangedAfter = new Date(`${input.asOf}T00:00:00.000Z`);
  recentlyChangedAfter.setUTCDate(recentlyChangedAfter.getUTCDate() - 30);
  const recentlyChangedOn = recentlyChangedAfter.toISOString().slice(0, 10);
  return {
    asOf: input.asOf,
    annualDetermination:
      input.annualEvaluationOn === null
        ? ('PENDING_CONFIGURATION' as const)
        : ('CONFIGURED' as const),
    items: input.rows.map((row) => {
      const classification: CertificationReadinessClassification =
        row.status !== 'active' || (row.expiresOn !== null && row.expiresOn < input.asOf)
          ? 'EXPIRED'
          : row.expiresOn !== null && row.expiresOn <= soonOn
            ? 'EXPIRING_SOON'
            : row.expiresOn === null
              ? 'VALID_NO_EXPIRATION'
              : 'VALID';
      return {
        ...row,
        classification,
        recentlyChanged: row.changedAt !== null && row.changedAt >= recentlyChangedOn,
        sourceProvenance: row.evidenceSource ?? 'MISSING_PROVENANCE',
        affectedBidOpportunities: 'NOT_DETERMINED_BY_READINESS_PROJECTION' as const,
      };
    }),
  };
}
