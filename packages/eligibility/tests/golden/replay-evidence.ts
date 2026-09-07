import { createHash } from 'node:crypto';
import { evaluateEligibility } from '../../src/evaluate.js';
import { compare } from '../../src/tie-break.js';
import type { Member, PositionRule } from '../../src/types.js';

export interface ReplayExpectation {
  caseId: string;
  employeeId: string;
  positionId: string;
  sourceLocation: string;
  authority: 'approved_expectation' | 'observed_award';
  eligible: boolean;
  points: number;
  soPoints: number;
  moPoints: number;
}

export interface ReplayManifest {
  v: 1;
  source: string;
  fixtureSha256: Record<string, string>;
  exclusions: Array<{ bidNumber: number; reason: string; sourceLocation: string }>;
  cases: ReplayExpectation[];
  orderings?: Array<{
    caseId: string;
    sourceLocation: string;
    authority: ReplayExpectation['authority'];
    positionId: string;
    candidateEmployeeIds: string[];
    /** Each group is an unresolved tie. Group order is the expected priority. */
    expectedPriorityGroups: string[][];
  }>;
}

export function assertFixtureHashes(manifest: ReplayManifest, files: Record<string, string>) {
  for (const [name, contents] of Object.entries(files)) {
    if (createHash('sha256').update(contents).digest('hex') !== manifest.fixtureSha256[name])
      throw new Error(`Replay fixture provenance mismatch: ${name}`);
  }
}

export function replayEvidence(members: Member[], rules: PositionRule[], manifest: ReplayManifest) {
  if (manifest.v !== 1 || !manifest.source.trim() || manifest.cases.length === 0)
    throw new Error('Replay requires source provenance and nonzero expected cases');
  const byMember = new Map(members.map((m) => [m.employeeId, m]));
  const byRule = new Map(rules.map((r) => [r.positionId, r]));
  if (byMember.size !== members.length || byRule.size !== rules.length)
    throw new Error('Replay contains ambiguous members or rules');
  const ids = new Set<string>();
  const failures: string[] = [];
  let evaluated = 0;
  const validAuthority = (value: string) =>
    value === 'approved_expectation' || value === 'observed_award';
  for (const expected of manifest.cases) {
    if (!expected.caseId.trim() || !expected.sourceLocation.trim() || ids.has(expected.caseId))
      throw new Error('Replay cases require unique identifiers and source locations');
    if (
      !validAuthority(expected.authority) ||
      ['points', 'soPoints', 'moPoints'].some(
        (key) => !Number.isFinite(expected[key as 'points' | 'soPoints' | 'moPoints']),
      )
    )
      throw new Error('Replay expectations require explicit authority and finite scores');
    ids.add(expected.caseId);
    const member = byMember.get(expected.employeeId);
    const rule = byRule.get(expected.positionId);
    if (!member || !rule)
      throw new Error(`Replay case ${expected.caseId} is missing a member or rule`);
    const actual = evaluateEligibility(member, rule);
    evaluated++;
    for (const key of ['eligible', 'points', 'soPoints', 'moPoints'] as const) {
      if (actual[key] !== expected[key]) failures.push(`${expected.caseId}:${key}`);
    }
  }
  for (const ordering of manifest.orderings ?? []) {
    if (
      !ordering.caseId.trim() ||
      ids.has(ordering.caseId) ||
      !ordering.sourceLocation.trim() ||
      !validAuthority(ordering.authority)
    )
      throw new Error('Replay ordering requires unique provenance and explicit authority');
    ids.add(ordering.caseId);
    const rule = byRule.get(ordering.positionId);
    if (!rule) throw new Error(`Replay ordering ${ordering.caseId} is missing a rule`);
    if (
      ordering.candidateEmployeeIds.length < 2 ||
      new Set(ordering.candidateEmployeeIds).size !== ordering.candidateEmployeeIds.length
    )
      throw new Error('Replay ordering requires at least two unambiguous candidates');
    const results = ordering.candidateEmployeeIds
      .map((employeeId) => {
        const member = byMember.get(employeeId);
        if (!member) throw new Error(`Replay ordering ${ordering.caseId} is missing a member`);
        return {
          employeeId,
          ...evaluateEligibility(member, rule),
          rscSeniority: member.rscSeniority,
          rankSeniority: member.rankSeniority ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .filter((result) => result.eligible)
      .sort((a, b) => compare(a, b, rule.tieBreakChain));
    const groups: string[][] = [];
    for (let i = 0; i < results.length; i++) {
      const current = results[i];
      const previous = results[i - 1];
      if (!current) continue;
      if (!previous || compare(previous, current, rule.tieBreakChain) !== 0)
        groups.push([current.employeeId]);
      else groups[groups.length - 1]?.push(current.employeeId);
    }
    const expectedIds = ordering.expectedPriorityGroups.flat();
    if (
      ordering.expectedPriorityGroups.some((group) => !group.length) ||
      new Set(expectedIds).size !== expectedIds.length ||
      expectedIds.some((id) => !ordering.candidateEmployeeIds.includes(id))
    )
      throw new Error('Replay expected ordering contains ambiguous or unknown candidates');
    const normalize = (items: string[][]) => items.map((group) => [...group].sort());
    if (
      JSON.stringify(normalize(groups)) !==
      JSON.stringify(normalize(ordering.expectedPriorityGroups))
    )
      failures.push(`${ordering.caseId}:ordering`);
  }
  return {
    evaluated,
    evaluatedOrderings: manifest.orderings?.length ?? 0,
    observedCases: manifest.cases.filter((c) => c.authority === 'observed_award').length,
    approvedCases: manifest.cases.filter((c) => c.authority === 'approved_expectation').length,
    eligibleCases: manifest.cases.filter((c) => c.eligible).length,
    negativeCases: manifest.cases.filter((c) => !c.eligible).length,
    failures,
  };
}
