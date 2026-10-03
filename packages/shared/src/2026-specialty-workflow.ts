import { type BidDefinitionContent, BidDefinitionContentSchema } from './schemas/bid-definition.js';
import type { FrozenAnnualSpecialtyPolicy } from './schemas/bid-policy.js';
import { type ConfiguredScoring, ConfiguredScoringSchema } from './schemas/configured-scoring.js';

const operations = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
];
const technicians = [
  'State Certified Hazardous Materials Technician',
  'Rope Rescue Technician',
  'Vehicle & Machinery Rescue Technician',
  'Confined Space Technician',
  'Structural Collapse Technician',
  'Trench Rescue Technician',
];
const sourceGroup = {
  id: 'special-operations-2026',
  cap: 13,
  items: [...operations, ...technicians, 'Drone Operator Qualified-Part 107 sUAS'].map(
    (credential, index) => ({
      credential,
      alternatives: [],
      requiresAll: index >= 6 && index < 12 ? operations : [],
      points: 1,
    }),
  ),
};
const sourceScoring: ConfiguredScoring = { v: 1, total: [sourceGroup], so: [sourceGroup], mo: [] };
const families = [
  { rank: 'CPT', stageId: 'captains', suffixes: ['201', '718'], label: 'Captain' },
  { rank: 'LT', stageId: 'lieutenants', suffixes: ['205', '208'], label: 'Lieutenant' },
  {
    rank: 'FF',
    stageId: 'firefighters',
    suffixes: ['204', '206', '207', '209', '210', '214'],
    label: 'Firefighter',
  },
] as const;
const timingSource =
  'Administrator instruction 2026-10-03: offer qualified Station #2 specialty seats out of order and select A-Day at the ordinary rank/seniority turn; final July 2026 Bid Policy Procedures 7, 11 and 14.';

function canonical(value: unknown): string {
  const ordered = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(ordered);
    if (entry !== null && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, ordered(child)]),
      );
    return entry;
  };
  return JSON.stringify(ordered(value));
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export type Prepare2026SpecialtyWorkflowResult =
  | { ok: false; code: string }
  | { ok: true; content: BidDefinitionContent; status: 'PREPARED' | 'ALREADY_CONFIGURED' };

/** Draft-only shortcut for the reviewed 2026 homogeneous Station #2 roles.
 * Qualification/scoring edits, other years, overlapping custom policies and
 * unknown timing scopes require ordinary authoring. This never saves a version
 * or changes a running session; the normal Impact/Review/Save remains required. */
export function prepare2026StationTwoSpecialtyWorkflow(
  content: BidDefinitionContent,
): Prepare2026SpecialtyWorkflowResult {
  const blocked = (code: string): Prepare2026SpecialtyWorkflowResult => ({ ok: false, code });
  if (content.bidYear !== 2026)
    return blocked('This shortcut applies only to the reviewed 2026 Bid.');
  if (content.settings?.v !== 3 || !content.policy)
    return blocked('The saved operating policy is required.');
  const policy = content.settings.livePolicy;
  if (!same(policy, content.policy.executionPolicy))
    return blocked('Reconcile the operating policy before preparing specialty workflows.');
  const annual = policy.annualOperations;
  const execution = annual?.aDay.execution;
  if (!annual || !execution || execution.timing !== 'SIMULTANEOUS')
    return blocked('Reviewed simultaneous ordinary A-Day execution is required.');
  const specialties: FrozenAnnualSpecialtyPolicy[] = [];
  const allIds = new Set<string>();
  try {
    for (const family of families) {
      const ids = ['A', 'B', 'C'].flatMap((shift) =>
        family.suffixes.map((suffix) => `${shift}${suffix}`),
      );
      let copiedScoring: ConfiguredScoring | undefined;
      const ordinal =
        family.rank === 'FF' ? 'department_service_bid_ordinal' : 'time_in_grade_bid_ordinal';
      for (const id of ids) {
        const positions = content.positions.filter((position) => position.id === id);
        const rules = content.rules.filter((rule) => rule.positionId === id);
        const participation = content.participation.filter((entry) => entry.positionId === id);
        if (
          positions.length !== 1 ||
          rules.length !== 1 ||
          participation.length !== 1 ||
          participation[0]?.bidParticipation !== 'BIDDABLE' ||
          positions[0]?.station !== 'Station #2' ||
          positions[0]?.shift !== id[0] ||
          positions[0]?.rankRequired !== family.rank
        )
          return blocked(`The reviewed Station #2 role ${id} has changed.`);
        const rule = rules[0];
        if (!rule) return blocked(`The saved rule for ${id} is missing.`);
        if (
          !same(JSON.parse(rule.requiredCriteriaJson), {
            rank: [family.rank],
            credentials: [],
            custom: [],
          }) ||
          !same(JSON.parse(rule.tieBreakChainJson), ['points', 'so_points', ordinal])
        )
          return blocked(`The source qualifications or ordering for ${id} have changed.`);
        const points = JSON.parse(rule.pointsPreferenceJson) as {
          max?: unknown;
          items?: unknown;
          scoring?: unknown;
        };
        const parsed = ConfiguredScoringSchema.safeParse(points.scoring);
        if (
          points.max !== 0 ||
          !same(points.items, []) ||
          !parsed.success ||
          !same(parsed.data, sourceScoring)
        )
          return blocked(`The source Special Operations scoring for ${id} has changed.`);
        copiedScoring ??= parsed.data;
        allIds.add(id);
      }
      if (
        !policy.stages.some(
          (stage) =>
            stage.id === family.stageId &&
            ids.every((id) => stage.opportunityPositionIds.includes(id)),
        )
      )
        return blocked(
          `The reviewed ${family.label} stage no longer contains its Station #2 roles.`,
        );
      if (!copiedScoring) return blocked('Source scoring is unavailable.');
      specialties.push({
        id: `2026-station-two-${family.rank.toLowerCase()}`,
        label: `Station 2 Special Operations · ${family.label}`,
        mode: 'INTERRUPTING',
        opportunityPositionIds: ids,
        requiredCredentialNames: [],
        requiredSpecialtyCodes: [],
        points: [],
        scoring: structuredClone(copiedScoring),
        rankingChannel: 'total',
        tieBreakChain: [
          'POINTS',
          family.rank === 'FF' ? 'DEPARTMENT_SERVICE_BID_ORDINAL' : 'TIME_IN_GRADE_BID_ORDINAL',
        ],
      });
    }
  } catch {
    return blocked('The saved source rules cannot be decoded.');
  }
  const existing = annual.specialties ?? [];
  for (const specialty of existing) {
    const expected = specialties.find((entry) => entry.id === specialty.id);
    if (
      expected
        ? !same(expected, specialty)
        : specialty.opportunityPositionIds.some((id) => allIds.has(id))
    )
      return blocked(
        'An existing specialty already governs these seats with different rules. Review it manually.',
      );
  }
  const exceptions = execution.timingExceptions ?? [];
  for (const exception of exceptions)
    if (
      exception.profileIds.length > 0 ||
      (exception.positionIds.some((id) => allIds.has(id)) &&
        exception.timing !== 'AFTER_POSITION_SELECTION')
    )
      return blocked('An existing A-Day timing scope requires manual review.');
  const covered = new Set(exceptions.flatMap((exception) => exception.positionIds));
  const additions = specialties.filter(
    (entry) => !existing.some((candidate) => candidate.id === entry.id),
  );
  const timingAdditions = specialties.flatMap((specialty) => {
    const positionIds = specialty.opportunityPositionIds.filter((id) => !covered.has(id));
    if (!positionIds.length) return [];
    const id = `${specialty.id}-ordinary-a-day`;
    if (exceptions.some((exception) => exception.id === id)) return [];
    return [
      {
        id,
        label: `${specialty.label} A-Day at ordinary turn`,
        timing: 'AFTER_POSITION_SELECTION' as const,
        sourceRef: timingSource,
        positionIds,
        profileIds: [],
      },
    ];
  });
  if (
    timingAdditions.flatMap((exception) => exception.positionIds).length !==
    [...allIds].filter((id) => !covered.has(id)).length
  )
    return blocked('A saved timing exception identity conflicts with this reviewed workflow.');
  if (!additions.length && !timingAdditions.length)
    return { ok: true, content, status: 'ALREADY_CONFIGURED' };
  const nextPolicy = {
    ...policy,
    annualOperations: {
      ...annual,
      specialties: [...existing, ...additions],
      aDay: {
        ...annual.aDay,
        execution: { ...execution, timingExceptions: [...exceptions, ...timingAdditions] },
      },
    },
  };
  const next: BidDefinitionContent = {
    ...content,
    settings: { ...content.settings, livePolicy: nextPolicy },
    policy: { ...content.policy, executionPolicy: nextPolicy },
  };
  if (!BidDefinitionContentSchema.safeParse(next).success)
    return blocked('The prepared policy requires normal configuration review.');
  return { ok: true, content: next, status: 'PREPARED' };
}
