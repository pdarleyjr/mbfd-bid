import type { PositionRule, Rank, TieBreakKey } from '@mbfd/eligibility';

type JsonColumn = 'requiredCriteriaJson' | 'pointsPreferenceJson' | 'tieBreakChainJson';

export type PositionRuleDecodeErrorCode =
  | 'invalid_row'
  | 'invalid_identifier'
  | 'malformed_json'
  | 'invalid_shape'
  | 'invalid_rank'
  | 'invalid_credential'
  | 'unsupported_custom'
  | 'invalid_points'
  | 'unknown_gating'
  | 'conflicting_gating'
  | 'unknown_field'
  | 'invalid_tie_break';

export interface PositionRuleDecodeIssue {
  column: JsonColumn | 'row';
  code: PositionRuleDecodeErrorCode;
  message: string;
  itemIndex?: number;
}

export type CanonicalOpsGate = 'paired_operation' | 'all_operations';

type DecodedPointsItem = PositionRule['pointsPreference']['items'][number] & {
  opsGate?: CanonicalOpsGate;
};

export type DecodedPositionRule = Omit<PositionRule, 'pointsPreference'> & {
  pointsPreference: Omit<PositionRule['pointsPreference'], 'items'> & {
    items: DecodedPointsItem[];
  };
};

export type PositionRuleDecodeResult =
  | { ok: true; rule: DecodedPositionRule }
  | { ok: false; issues: readonly PositionRuleDecodeIssue[] };

/**
 * Result of decoding every persisted rule that belongs to a rule book.  A
 * duplicate position is a policy error even if each duplicate row parses:
 * consumers otherwise disagree about which rule is authoritative.
 */
export interface RuleBookDecodeResult {
  rules: readonly DecodedPositionRule[];
  invalidPositionIds: readonly string[];
  duplicatePositionIds: readonly string[];
}

const RANKS = new Set<Rank>(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']);
const CUSTOM_CRITERIA = new Set<PositionRule['requiredCriteria']['custom'][number]>([
  'paramedic',
  'driver_engineer',
  'non_probationary',
]);
const TIE_BREAK_KEYS = new Set<TieBreakKey>([
  'points',
  'so_points',
  'mo_points',
  'rsc_seniority',
  'rank_seniority',
]);
const OPS_GATES = new Set<CanonicalOpsGate>(['paired_operation', 'all_operations']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addIssue(issues: PositionRuleDecodeIssue[], issue: PositionRuleDecodeIssue): void {
  issues.push(issue);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  column: JsonColumn,
  issues: PositionRuleDecodeIssue[],
  itemIndex?: number,
): void {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      addIssue(issues, {
        column,
        code: 'unknown_field',
        message: 'policy data contains an unsupported field',
        ...(itemIndex === undefined ? {} : { itemIndex }),
      });
    }
  }
}

function parseJsonColumn(
  row: Record<string, unknown>,
  column: JsonColumn,
  issues: PositionRuleDecodeIssue[],
): unknown | undefined {
  const serialized = row[column];
  if (typeof serialized !== 'string') {
    addIssue(issues, {
      column,
      code: 'invalid_shape',
      message: `${column} must be a JSON string`,
    });
    return undefined;
  }

  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    addIssue(issues, {
      column,
      code: 'malformed_json',
      message: `${column} is not valid JSON`,
    });
    return undefined;
  }
}

function decodeRequiredCriteria(
  value: unknown,
  issues: PositionRuleDecodeIssue[],
): PositionRule['requiredCriteria'] | undefined {
  const issueCount = issues.length;
  if (!isRecord(value)) {
    addIssue(issues, {
      column: 'requiredCriteriaJson',
      code: 'invalid_shape',
      message: 'required criteria must be an object',
    });
    return undefined;
  }
  rejectUnknownFields(
    value,
    new Set(['rank', 'credentials', 'custom']),
    'requiredCriteriaJson',
    issues,
  );

  if (!Array.isArray(value.rank) || value.rank.length === 0) {
    addIssue(issues, {
      column: 'requiredCriteriaJson',
      code: 'invalid_rank',
      message: 'required criteria must contain at least one supported rank',
    });
  }

  const rank: Rank[] = [];
  if (Array.isArray(value.rank)) {
    for (const rawRank of value.rank) {
      const normalized = trimText(rawRank);
      if (!normalized || !RANKS.has(normalized as Rank)) {
        addIssue(issues, {
          column: 'requiredCriteriaJson',
          code: 'invalid_rank',
          message: 'required criteria contains an unsupported rank',
        });
        continue;
      }
      rank.push(normalized as Rank);
    }
  }

  const credentials = decodeStringArray(
    value.credentials,
    'requiredCriteriaJson',
    'invalid_credential',
    'required credentials',
    issues,
  );

  const custom: PositionRule['requiredCriteria']['custom'] = [];
  if (!Array.isArray(value.custom)) {
    addIssue(issues, {
      column: 'requiredCriteriaJson',
      code: 'invalid_shape',
      message: 'required custom criteria must be an array',
    });
  } else {
    for (const rawCustom of value.custom) {
      const normalized = trimText(rawCustom);
      if (
        !normalized ||
        !CUSTOM_CRITERIA.has(normalized as PositionRule['requiredCriteria']['custom'][number])
      ) {
        addIssue(issues, {
          column: 'requiredCriteriaJson',
          code: 'unsupported_custom',
          message: 'required criteria contains an unsupported custom condition',
        });
        continue;
      }
      custom.push(normalized as PositionRule['requiredCriteria']['custom'][number]);
    }
  }

  if (issues.length > issueCount || !credentials) return undefined;
  return { rank, credentials, custom };
}

function decodeStringArray(
  value: unknown,
  column: JsonColumn,
  code: 'invalid_credential',
  label: string,
  issues: PositionRuleDecodeIssue[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    addIssue(issues, {
      column,
      code: 'invalid_shape',
      message: `${label} must be an array`,
    });
    return undefined;
  }

  const values: string[] = [];
  const issueCount = issues.length;
  for (const rawValue of value) {
    const normalized = trimText(rawValue);
    if (!normalized) {
      addIssue(issues, {
        column,
        code,
        message: `${label} must contain non-empty strings`,
      });
      continue;
    }
    values.push(normalized);
  }
  return issues.length === issueCount ? values : undefined;
}

function decodePointsPreference(
  value: unknown,
  issues: PositionRuleDecodeIssue[],
): DecodedPositionRule['pointsPreference'] | undefined {
  const issueCount = issues.length;
  if (!isRecord(value)) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_shape',
      message: 'points preference must be an object',
    });
    return undefined;
  }
  rejectUnknownFields(value, new Set(['max', 'items']), 'pointsPreferenceJson', issues);

  const max = value.max;
  if (!isNonNegativeInteger(max)) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_points',
      message: 'points preference max must be a non-negative integer',
    });
  }

  if (!Array.isArray(value.items)) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_shape',
      message: 'points preference items must be an array',
    });
    return undefined;
  }

  const items: DecodedPointsItem[] = [];
  for (const [itemIndex, rawItem] of value.items.entries()) {
    const item = decodePointsItem(rawItem, itemIndex, issues);
    if (item) items.push(item);
  }

  if (issues.length > issueCount || !isNonNegativeInteger(max)) return undefined;
  return { max, items };
}

function decodePointsItem(
  value: unknown,
  itemIndex: number,
  issues: PositionRuleDecodeIssue[],
): DecodedPointsItem | undefined {
  const issueCount = issues.length;
  if (!isRecord(value)) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_shape',
      message: 'points preference item must be an object',
      itemIndex,
    });
    return undefined;
  }
  rejectUnknownFields(
    value,
    new Set(['points', 'credential', 'gating', 'opsGate', 'requiresOpsPair']),
    'pointsPreferenceJson',
    issues,
    itemIndex,
  );

  if (!isNonNegativeInteger(value.points)) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_points',
      message: 'points preference item points must be a non-negative integer',
      itemIndex,
    });
  }

  const credential = trimText(value.credential);
  if (!credential) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'invalid_credential',
      message: 'points preference item credential must be a non-empty string',
      itemIndex,
    });
  }

  const gate = decodeOpsGate(value, itemIndex, issues);
  if (issues.length > issueCount || !credential || !isNonNegativeInteger(value.points) || !gate) {
    return undefined;
  }

  const item: DecodedPointsItem = {
    points: value.points,
    credential,
    requiresOpsPair: gate.requiresOpsPair,
  };
  if (gate.opsGate) item.opsGate = gate.opsGate;
  return item;
}

function decodeOpsGate(
  value: Record<string, unknown>,
  itemIndex: number,
  issues: PositionRuleDecodeIssue[],
): { requiresOpsPair: boolean; opsGate?: CanonicalOpsGate } | undefined {
  const issueCount = issues.length;
  let legacyGating: CanonicalOpsGate | undefined;
  let canonicalOpsGate: CanonicalOpsGate | undefined;
  let legacyRequiresOpsPair: boolean | undefined;

  if (hasOwn(value, 'gating')) {
    const rawGating = trimText(value.gating);
    if (rawGating !== 'ops_all_6') {
      addIssue(issues, {
        column: 'pointsPreferenceJson',
        code: 'unknown_gating',
        message: 'points preference item contains an unsupported gating value',
        itemIndex,
      });
    } else {
      legacyGating = 'all_operations';
    }
  }

  if (hasOwn(value, 'opsGate')) {
    const rawOpsGate = trimText(value.opsGate);
    if (!rawOpsGate || !OPS_GATES.has(rawOpsGate as CanonicalOpsGate)) {
      addIssue(issues, {
        column: 'pointsPreferenceJson',
        code: 'unknown_gating',
        message: 'points preference item contains an unsupported opsGate value',
        itemIndex,
      });
    } else {
      canonicalOpsGate = rawOpsGate as CanonicalOpsGate;
    }
  }

  if (hasOwn(value, 'requiresOpsPair')) {
    if (typeof value.requiresOpsPair !== 'boolean') {
      addIssue(issues, {
        column: 'pointsPreferenceJson',
        code: 'unknown_gating',
        message: 'points preference item requiresOpsPair must be a boolean',
        itemIndex,
      });
    } else {
      legacyRequiresOpsPair = value.requiresOpsPair;
    }
  }

  if (legacyGating && canonicalOpsGate && legacyGating !== canonicalOpsGate) {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'conflicting_gating',
      message: 'points preference item gating and opsGate disagree',
      itemIndex,
    });
  }

  const explicitOpsGate = canonicalOpsGate ?? legacyGating;
  if (legacyRequiresOpsPair === true && explicitOpsGate === 'all_operations') {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'conflicting_gating',
      message: 'points preference item requiresOpsPair conflicts with all-operations gating',
      itemIndex,
    });
  }
  if (legacyRequiresOpsPair === false && explicitOpsGate === 'paired_operation') {
    addIssue(issues, {
      column: 'pointsPreferenceJson',
      code: 'conflicting_gating',
      message: 'points preference item requiresOpsPair conflicts with paired-operation gating',
      itemIndex,
    });
  }

  if (issues.length > issueCount) return undefined;

  if (explicitOpsGate) {
    return {
      requiresOpsPair: explicitOpsGate === 'paired_operation',
      opsGate: explicitOpsGate,
    };
  }

  if (legacyRequiresOpsPair === true) return { requiresOpsPair: true };
  return { requiresOpsPair: false };
}

function decodeTieBreakChain(
  value: unknown,
  issues: PositionRuleDecodeIssue[],
): TieBreakKey[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, {
      column: 'tieBreakChainJson',
      code: 'invalid_tie_break',
      message: 'tie-break chain must be a non-empty array of supported keys',
    });
    return undefined;
  }

  const issueCount = issues.length;
  const keys: TieBreakKey[] = [];
  const seen = new Set<TieBreakKey>();
  for (const rawKey of value) {
    const normalized = trimText(rawKey);
    if (!normalized || !TIE_BREAK_KEYS.has(normalized as TieBreakKey)) {
      addIssue(issues, {
        column: 'tieBreakChainJson',
        code: 'invalid_tie_break',
        message: 'tie-break chain contains an unsupported key',
      });
      continue;
    }

    const key = normalized as TieBreakKey;
    if (seen.has(key)) {
      addIssue(issues, {
        column: 'tieBreakChainJson',
        code: 'invalid_tie_break',
        message: 'tie-break chain must not contain duplicate keys',
      });
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return issues.length === issueCount ? keys : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Converts the three persisted JSON columns into the policy engine's typed
 * rule. This is deliberately fail-closed: unmodelled or contradictory policy
 * values produce structured issues instead of a partially applied rule.
 */
export function decodePositionRule(row: unknown): PositionRuleDecodeResult {
  const issues: PositionRuleDecodeIssue[] = [];
  if (!isRecord(row)) {
    return {
      ok: false,
      issues: [
        {
          column: 'row',
          code: 'invalid_row',
          message: 'persisted position rule must be an object',
        },
      ],
    };
  }

  const positionId = trimText(row.positionId);
  if (!positionId) {
    addIssue(issues, {
      column: 'row',
      code: 'invalid_identifier',
      message: 'positionId must be a non-empty string',
    });
  }

  const ruleBookVersion = trimText(row.ruleBookVersion);
  if (!ruleBookVersion) {
    addIssue(issues, {
      column: 'row',
      code: 'invalid_identifier',
      message: 'ruleBookVersion must be a non-empty string',
    });
  }

  const requiredCriteria = decodeRequiredCriteria(
    parseJsonColumn(row, 'requiredCriteriaJson', issues),
    issues,
  );
  const pointsPreference = decodePointsPreference(
    parseJsonColumn(row, 'pointsPreferenceJson', issues),
    issues,
  );
  const tieBreakChain = decodeTieBreakChain(
    parseJsonColumn(row, 'tieBreakChainJson', issues),
    issues,
  );

  if (
    !positionId ||
    !ruleBookVersion ||
    !requiredCriteria ||
    !pointsPreference ||
    !tieBreakChain ||
    issues.length
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    rule: {
      positionId,
      ruleBookVersion,
      requiredCriteria,
      pointsPreference,
      tieBreakChain,
    },
  };
}

function positionIdForReport(row: unknown, rowIndex: number): string {
  if (isRecord(row)) return trimText(row.positionId) ?? `row:${rowIndex + 1}`;
  return `row:${rowIndex + 1}`;
}

/**
 * Decodes a complete rule book rather than allowing each caller to choose a
 * row opportunistically.  Evaluation and publication callers must reject a
 * book with malformed rows or duplicate position identities.
 */
export function decodeRuleBookRows(rows: readonly unknown[]): RuleBookDecodeResult {
  const rules: DecodedPositionRule[] = [];
  const invalidPositionIds: string[] = [];
  const duplicatePositionIds = new Set<string>();
  const seenPositionIds = new Set<string>();

  for (const [rowIndex, row] of rows.entries()) {
    const decoded = decodePositionRule(row);
    if (!decoded.ok) {
      invalidPositionIds.push(positionIdForReport(row, rowIndex));
      continue;
    }

    if (seenPositionIds.has(decoded.rule.positionId)) {
      duplicatePositionIds.add(decoded.rule.positionId);
    }
    seenPositionIds.add(decoded.rule.positionId);
    rules.push(decoded.rule);
  }

  return {
    rules,
    invalidPositionIds,
    duplicatePositionIds: [...duplicatePositionIds],
  };
}
