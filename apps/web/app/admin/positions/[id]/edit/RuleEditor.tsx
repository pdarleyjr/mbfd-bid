'use client';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import {
  RULE_CUSTOM_CRITERIA as CUSTOM_CRITERIA,
  type ConfiguredScoring,
  ConfiguredScoringSchema,
  RULE_OPS_GATES as OPS_GATES,
  type PostAwardObligation,
  PostAwardObligationsSchema,
  QualificationAlternativesSchema,
  ANNUAL_POSITION_RANKS as RANKS,
  ServiceRequirementsSchema,
  RULE_TIE_BREAK_KEYS as TIE_BREAK_KEYS,
} from '@mbfd/shared';

import { PostAwardObligationsEditor } from '@/components/admin/PostAwardObligationsEditor';
import { QualificationAlternativesEditor } from '@/components/admin/QualificationAlternativesEditor';
import { ServiceRequirementsEditor } from '@/components/admin/ServiceRequirementsEditor';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft } from '../../../../../lib/draft-storage';
import { ConfiguredScoringEditor } from './ConfiguredScoringEditor';

const legacyRouteFor = (pid: string): string => `/admin/positions/${pid}/edit`;
const routeFor = (pid: string, ruleBookVersion: string): string =>
  `${legacyRouteFor(pid)}?rule_book_version=${encodeURIComponent(ruleBookVersion)}`;

type Rank = (typeof RANKS)[number];
type CustomCriterion = (typeof CUSTOM_CRITERIA)[number];
type OpsGate = (typeof OPS_GATES)[number];
type TieBreakKey = (typeof TIE_BREAK_KEYS)[number];

const RANK_LABELS: Record<Rank, string> = {
  FF: 'Firefighter (FF)',
  LT: 'Lieutenant (LT)',
  CPT: 'Captain (CPT)',
  DC: 'Division Chief (DC)',
};

const CUSTOM_CRITERIA_LABELS: Record<CustomCriterion, string> = {
  paramedic: 'Paramedic',
  driver_engineer: 'Driver engineer',
  non_probationary: 'Non-probationary',
};

const OPS_GATE_LABELS: Record<OpsGate, string> = {
  paired_operation: 'Require the paired Operations credential',
  all_operations: 'Require all six Operations credentials',
};

const TIE_BREAK_LABELS: Record<TieBreakKey, string> = {
  points: 'Total points',
  so_points: 'Special-operations points',
  mo_points: 'Marine-operations points',
  rsc_seniority: 'RSC seniority',
  rank_seniority: 'Rank seniority',
};

interface InitialRule {
  id: number;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
}

interface PointRow {
  clientId: string;
  credential: string;
  points: string;
  opsGate: OpsGate | '';
}

interface EditorValues {
  ruleId: number | null;
  requiredRanks: Rank[];
  requiredCredentials: string;
  anyOfCredentials: string[][];
  service: { serviceCode: string; minimumMonths: number }[];
  postAward: PostAwardObligation[];
  customCriteria: CustomCriterion[];
  maxPoints: string;
  pointRows: PointRow[];
  scoring: ConfiguredScoring | null;
  tieBreakChain: TieBreakKey[];
}

interface TypedDraftValues extends EditorValues {
  version: 1;
  baseRevision?: number | null;
}

interface DecodedEditorValues {
  values: EditorValues;
  issues: string[];
}

function emptyValues(ruleId: number | null = null): EditorValues {
  return {
    ruleId,
    requiredRanks: ['FF'],
    requiredCredentials: '',
    anyOfCredentials: [],
    service: [],
    postAward: [],
    customCriteria: [],
    maxPoints: '0',
    pointRows: [],
    scoring: null,
    tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

function isCustomCriterion(value: unknown): value is CustomCriterion {
  return typeof value === 'string' && (CUSTOM_CRITERIA as readonly string[]).includes(value);
}

function isOpsGate(value: unknown): value is OpsGate {
  return typeof value === 'string' && (OPS_GATES as readonly string[]).includes(value);
}

function isPointRowClientId(value: unknown): value is string {
  return typeof value === 'string' && /^point-row-[a-z0-9_-]{1,80}$/.test(value);
}

function initialPointRowClientId(index: number): string {
  return `point-row-initial-${index + 1}`;
}

function createNextPointRow(rows: readonly PointRow[]): PointRow {
  const usedClientIds = new Set(rows.map((row) => row.clientId));
  let sequence = 1;
  let clientId = `point-row-new-${sequence}`;
  while (usedClientIds.has(clientId)) {
    sequence += 1;
    clientId = `point-row-new-${sequence}`;
  }
  return { clientId, credential: '', points: '0', opsGate: '' };
}

function isTieBreakKey(value: unknown): value is TieBreakKey {
  return typeof value === 'string' && (TIE_BREAK_KEYS as readonly string[]).includes(value);
}

function addUnexpectedFieldIssues(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${label} contains unsupported field “${key}”.`);
  }
}

function duplicateValue(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function lineValues(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isNonNegativeInteger(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

function decodeRanks(value: unknown, issues: string[]): Rank[] {
  if (!Array.isArray(value)) {
    issues.push('Required ranks must be a list of supported ranks.');
    return [];
  }
  if (value.length === 0) issues.push('At least one required rank is needed.');

  const ranks: Rank[] = [];
  for (const item of value) {
    if (!isRank(item)) {
      issues.push('Required ranks contains an unsupported rank.');
      continue;
    }
    ranks.push(item);
  }
  if (duplicateValue(ranks)) issues.push('Required ranks contains a duplicate rank.');
  return ranks;
}

function decodeCredentials(value: unknown, issues: string[], label: string): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be a list of exact credential names.`);
    return [];
  }

  const credentials: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0 || /\r|\n/.test(item)) {
      issues.push(`${label} contains an invalid credential name.`);
      continue;
    }
    credentials.push(item.trim());
  }
  if (duplicateValue(credentials)) issues.push(`${label} contains a duplicate credential name.`);
  return credentials;
}

function decodeCustomCriteria(value: unknown, issues: string[]): CustomCriterion[] {
  if (!Array.isArray(value)) {
    issues.push('Custom eligibility conditions must be a list of supported conditions.');
    return [];
  }

  const criteria: CustomCriterion[] = [];
  for (const item of value) {
    if (!isCustomCriterion(item)) {
      issues.push('Required criteria contains an unsupported custom eligibility condition.');
      continue;
    }
    criteria.push(item);
  }
  if (duplicateValue(criteria))
    issues.push('Custom eligibility conditions contains a duplicate condition.');
  return criteria;
}

function decodePointRows(value: unknown, issues: string[]): PointRow[] {
  if (!Array.isArray(value)) {
    issues.push('Credential point rows must be a list.');
    return [];
  }

  const rows: PointRow[] = [];
  for (const [index, rawItem] of value.entries()) {
    const itemLabel = `Credential point row ${index + 1}`;
    if (!isRecord(rawItem)) {
      issues.push(`${itemLabel} is not a supported point row.`);
      continue;
    }
    addUnexpectedFieldIssues(
      rawItem,
      ['credential', 'points', 'gating', 'requiresOpsPair', 'opsGate'],
      itemLabel,
      issues,
    );

    const credential =
      typeof rawItem.credential === 'string' &&
      rawItem.credential.trim().length > 0 &&
      !/\r|\n/.test(rawItem.credential)
        ? rawItem.credential.trim()
        : '';
    if (!credential) issues.push(`${itemLabel} requires an exact credential name.`);

    const points =
      typeof rawItem.points === 'number' &&
      Number.isSafeInteger(rawItem.points) &&
      rawItem.points >= 0
        ? String(rawItem.points)
        : '';
    if (!points) issues.push(`${itemLabel} points must be a non-negative whole number.`);

    let legacyGate: OpsGate | undefined;
    if (hasOwn(rawItem, 'gating')) {
      if (rawItem.gating === 'ops_all_6') {
        legacyGate = 'all_operations';
      } else {
        issues.push(`${itemLabel} has an unsupported Operations gate.`);
      }
    }

    let canonicalGate: OpsGate | undefined;
    if (hasOwn(rawItem, 'opsGate')) {
      if (isOpsGate(rawItem.opsGate)) {
        canonicalGate = rawItem.opsGate;
      } else {
        issues.push(`${itemLabel} has an unsupported Operations gate.`);
      }
    }

    let legacyRequiresOpsPair: boolean | undefined;
    if (hasOwn(rawItem, 'requiresOpsPair')) {
      if (typeof rawItem.requiresOpsPair === 'boolean') {
        legacyRequiresOpsPair = rawItem.requiresOpsPair;
      } else {
        issues.push(`${itemLabel} has an unsupported Operations gate.`);
      }
    }

    const effectiveGate = canonicalGate ?? legacyGate;
    if (legacyGate && canonicalGate && legacyGate !== canonicalGate) {
      issues.push(`${itemLabel} has conflicting Operations gates.`);
    }
    if (legacyRequiresOpsPair === true && effectiveGate === 'all_operations') {
      issues.push(`${itemLabel} has conflicting Operations gates.`);
    }
    if (legacyRequiresOpsPair === false && effectiveGate === 'paired_operation') {
      issues.push(`${itemLabel} has conflicting Operations gates.`);
    }

    rows.push({
      clientId: initialPointRowClientId(index),
      credential,
      points,
      opsGate: effectiveGate ?? (legacyRequiresOpsPair === true ? 'paired_operation' : ''),
    });
  }
  return rows;
}

function decodeTieBreakChain(value: unknown, issues: string[]): TieBreakKey[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push('Tie-break order must contain at least one supported selection.');
    return [];
  }

  const keys: TieBreakKey[] = [];
  for (const item of value) {
    if (!isTieBreakKey(item)) {
      issues.push('Tie-break order contains an unsupported selection.');
      continue;
    }
    keys.push(item);
  }
  if (duplicateValue(keys)) issues.push('Tie-break order contains a duplicate selection.');
  return keys;
}

function decodeInitialRule(initialRule: InitialRule): DecodedEditorValues {
  const values = emptyValues();
  const issues: string[] = [];
  if (!isRecord(initialRule)) {
    return { values, issues: ['The saved rule could not be read by this form.'] };
  }
  if (!Number.isSafeInteger(initialRule.id) || initialRule.id <= 0) {
    issues.push('The saved rule has an invalid rule identifier.');
  } else {
    values.ruleId = initialRule.id;
  }

  if (!isRecord(initialRule.requiredCriteria)) {
    issues.push('Required criteria is not a supported rule section.');
  } else {
    addUnexpectedFieldIssues(
      initialRule.requiredCriteria,
      ['rank', 'credentials', 'custom', 'anyOfCredentials', 'service', 'postAward'],
      'Required criteria',
      issues,
    );
    values.requiredRanks = decodeRanks(initialRule.requiredCriteria.rank, issues);
    values.requiredCredentials = decodeCredentials(
      initialRule.requiredCriteria.credentials,
      issues,
      'Required credential names',
    ).join('\n');
    values.customCriteria = decodeCustomCriteria(initialRule.requiredCriteria.custom, issues);
    const alternatives = QualificationAlternativesSchema.safeParse(
      initialRule.requiredCriteria.anyOfCredentials ?? [],
    );
    if (alternatives.success) values.anyOfCredentials = alternatives.data;
    else issues.push('Saved qualification alternatives are invalid.');
    const service = ServiceRequirementsSchema.safeParse(initialRule.requiredCriteria.service ?? []);
    if (service.success) values.service = service.data;
    else issues.push('Saved service requirements are invalid.');
    const postAward = PostAwardObligationsSchema.safeParse(
      initialRule.requiredCriteria.postAward ?? [],
    );
    if (postAward.success) values.postAward = postAward.data;
    else issues.push('Saved post-award obligations are invalid.');
  }

  if (!isRecord(initialRule.pointsPreference)) {
    issues.push('Points preference is not a supported rule section.');
  } else {
    addUnexpectedFieldIssues(
      initialRule.pointsPreference,
      ['max', 'items', 'scoring'],
      'Points preference',
      issues,
    );
    if (
      typeof initialRule.pointsPreference.max !== 'number' ||
      !Number.isSafeInteger(initialRule.pointsPreference.max) ||
      initialRule.pointsPreference.max < 0
    ) {
      issues.push('Maximum points must be a non-negative whole number.');
      values.maxPoints = '';
    } else {
      values.maxPoints = String(initialRule.pointsPreference.max);
    }
    values.pointRows = decodePointRows(initialRule.pointsPreference.items, issues);
    if (initialRule.pointsPreference.scoring !== undefined) {
      const scoring = ConfiguredScoringSchema.safeParse(initialRule.pointsPreference.scoring);
      if (scoring.success) values.scoring = scoring.data;
      else issues.push('Explicit channel scoring requires review before editing.');
    }
  }

  values.tieBreakChain = decodeTieBreakChain(initialRule.tieBreakChain, issues);
  return { values, issues };
}

function validateEditorValues(values: EditorValues, requireRuleId: boolean): string[] {
  const alternatives = QualificationAlternativesSchema.safeParse(values.anyOfCredentials);
  const issues: string[] = [];
  if (requireRuleId && (!Number.isSafeInteger(values.ruleId) || (values.ruleId ?? 0) <= 0)) {
    issues.push('Set a valid rule ID before saving.');
  }
  if (values.requiredRanks.length === 0) issues.push('Select at least one required rank.');
  if (duplicateValue(values.requiredRanks))
    issues.push('Required ranks contains a duplicate rank.');
  if (duplicateValue(values.customCriteria)) {
    issues.push('Custom eligibility conditions contains a duplicate condition.');
  }

  if (!alternatives.success)
    issues.push('Every qualification group must contain at least one distinct credential.');
  if (!ServiceRequirementsSchema.safeParse(values.service).success)
    issues.push('Review the service categories and minimum months.');
  if (!PostAwardObligationsSchema.safeParse(values.postAward).success)
    issues.push('Review post-award qualifications, deadlines and sources.');
  const credentials = lineValues(values.requiredCredentials);
  if (duplicateValue(credentials))
    issues.push('Required credential names contains a duplicate credential name.');

  if (!isNonNegativeInteger(values.maxPoints)) {
    issues.push('Maximum points must be a non-negative whole number.');
  }
  for (const [index, row] of values.pointRows.entries()) {
    const itemLabel = `Credential point row ${index + 1}`;
    if (!row.credential.trim() || /\r|\n/.test(row.credential)) {
      issues.push(`${itemLabel} requires an exact credential name.`);
    }
    if (!isNonNegativeInteger(row.points)) {
      issues.push(`${itemLabel} points must be a non-negative whole number.`);
    }
    if (row.opsGate !== '' && !isOpsGate(row.opsGate)) {
      issues.push(`${itemLabel} has an unsupported Operations gate.`);
    }
  }

  if (values.tieBreakChain.length === 0) {
    issues.push('Tie-break order must contain at least one selection.');
  }
  if (duplicateValue(values.tieBreakChain)) {
    issues.push('Tie-break order contains a duplicate selection.');
  }
  if (values.scoring !== null) {
    const scoring = ConfiguredScoringSchema.safeParse(values.scoring);
    if (!scoring.success)
      issues.push(
        ...scoring.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
  }
  return issues;
}

function decodeDraftValues(value: unknown, expectedRuleId: number | null): DecodedEditorValues {
  const fallback = emptyValues(expectedRuleId);
  if (!isRecord(value)) {
    return {
      values: fallback,
      issues: ['A saved local rule draft is not a supported no-code draft.'],
    };
  }
  const issues: string[] = [];
  addUnexpectedFieldIssues(
    value,
    [
      'version',
      'ruleId',
      'requiredRanks',
      'requiredCredentials',
      'anyOfCredentials',
      'service',
      'postAward',
      'customCriteria',
      'maxPoints',
      'pointRows',
      'scoring',
      'baseRevision',
      'tieBreakChain',
    ],
    'Saved local rule draft',
    issues,
  );
  if (value.version !== 1)
    issues.push('A saved local rule draft uses an unsupported editor version.');

  const ruleId =
    value.ruleId === null ||
    (typeof value.ruleId === 'number' && Number.isSafeInteger(value.ruleId))
      ? value.ruleId
      : null;
  if (ruleId === null && value.ruleId !== null)
    issues.push('A saved local rule draft has an invalid rule ID.');
  if (expectedRuleId !== null && ruleId !== expectedRuleId) {
    issues.push('A saved local rule draft belongs to a different rule and cannot be applied here.');
  }

  const requiredRanks = decodeRanks(value.requiredRanks, issues);
  const customCriteria = decodeCustomCriteria(value.customCriteria, issues);
  const requiredCredentials =
    typeof value.requiredCredentials === 'string' ? value.requiredCredentials : '';
  if (typeof value.requiredCredentials !== 'string') {
    issues.push('A saved local rule draft has invalid required credential names.');
  }
  const maxPoints = typeof value.maxPoints === 'string' ? value.maxPoints : '';
  if (typeof value.maxPoints !== 'string') {
    issues.push('A saved local rule draft has invalid maximum points.');
  }

  const pointRows: PointRow[] = [];
  if (!Array.isArray(value.pointRows)) {
    issues.push('A saved local rule draft has invalid credential point rows.');
  } else {
    for (const [index, row] of value.pointRows.entries()) {
      if (
        !isRecord(row) ||
        typeof row.credential !== 'string' ||
        typeof row.points !== 'string' ||
        (row.opsGate !== '' && !isOpsGate(row.opsGate))
      ) {
        issues.push(`Saved local credential point row ${index + 1} is not supported.`);
        continue;
      }
      addUnexpectedFieldIssues(
        row,
        ['clientId', 'credential', 'points', 'opsGate'],
        'Saved local credential point row',
        issues,
      );
      if (hasOwn(row, 'clientId') && !isPointRowClientId(row.clientId)) {
        issues.push(
          `Saved local credential point row ${index + 1} has an invalid stable row identifier.`,
        );
        continue;
      }
      pointRows.push({
        clientId: isPointRowClientId(row.clientId) ? row.clientId : initialPointRowClientId(index),
        credential: row.credential,
        points: row.points,
        opsGate: row.opsGate,
      });
    }
  }

  const tieBreakChain = decodeTieBreakChain(value.tieBreakChain, issues);
  const scoring = value.scoring == null ? null : ConfiguredScoringSchema.safeParse(value.scoring);
  if (scoring && !scoring.success) issues.push('Saved channel scoring is invalid.');
  const alternatives = QualificationAlternativesSchema.safeParse(value.anyOfCredentials ?? []);
  if (!alternatives.success) issues.push('Saved qualification alternatives are invalid.');
  const service = ServiceRequirementsSchema.safeParse(value.service ?? []);
  if (!service.success) issues.push('Saved service requirements are invalid.');
  const postAward = PostAwardObligationsSchema.safeParse(value.postAward ?? []);
  if (!postAward.success) issues.push('Saved post-award obligations are invalid.');
  const draftValues: EditorValues = {
    ruleId,
    requiredRanks,
    requiredCredentials,
    anyOfCredentials: alternatives.success ? alternatives.data : [],
    service: service.success ? service.data : [],
    postAward: postAward.success ? postAward.data : [],
    customCriteria,
    maxPoints,
    pointRows,
    scoring: scoring?.success ? scoring.data : null,
    tieBreakChain,
  };
  issues.push(...validateEditorValues(draftValues, true));
  return { values: draftValues, issues };
}

function toDraftValues(values: EditorValues): TypedDraftValues {
  return { version: 1, ...values };
}

function updateList<T extends string>(values: readonly T[], value: T, selected: boolean): T[] {
  return selected ? [...values, value] : values.filter((item) => item !== value);
}

export function RuleEditor({
  positionId,
  ruleBookVersion,
  ruleBookRevision,
  initialRule,
}: {
  positionId: string;
  ruleBookVersion: string;
  ruleBookRevision?: number | null;
  initialRule: InitialRule;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pendingSave = useRef<{ fingerprint: string; key: string } | null>(null);
  const initial = decodeInitialRule(initialRule);
  const [values, setValues] = useState<EditorValues>(initial.values);
  const [initialIssues, setInitialIssues] = useState<string[]>(initial.issues);
  const [draftIssues, setDraftIssues] = useState<string[]>([]);
  const [hydratedEditorKey, setHydratedEditorKey] = useState<string | null>(null);
  const [hasLegacyDraft, setHasLegacyDraft] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(ruleBookRevision);

  useEffect(() => {
    const nextInitial = decodeInitialRule(initialRule);
    const scopedRoute = routeFor(positionId, ruleBookVersion);
    if (hydratedEditorKey === scopedRoute) return;
    const draft = loadDraft<unknown>(scopedRoute, 'rule');
    const legacyDraft =
      draft === null ? loadDraft<unknown>(legacyRouteFor(positionId), 'rule') : null;
    let nextValues = nextInitial.values;
    let nextDraftIssues: string[] = [];

    if (draft !== null) {
      const decodedDraft = decodeDraftValues(draft.values, nextInitial.values.ruleId);
      if (decodedDraft.issues.length === 0 && nextInitial.issues.length === 0) {
        nextValues = decodedDraft.values;
        const stored = isRecord(draft.values) ? draft.values.baseRevision : undefined;
        if (ruleBookRevision != null && (!Number.isInteger(stored) || Number(stored) < 0)) {
          nextDraftIssues.push(
            'The saved draft has no reviewed source revision. Discard it and reopen the current rule before saving.',
          );
        }
      } else {
        nextDraftIssues = decodedDraft.issues;
      }
    } else if (legacyDraft !== null) {
      nextDraftIssues = [
        'A saved local rule draft is not bound to this configured rule book and cannot be applied.',
      ];
    }

    setValues(nextValues);
    setBaseRevision(
      draft && isRecord(draft.values) && typeof draft.values.baseRevision === 'number'
        ? draft.values.baseRevision
        : ruleBookRevision,
    );
    setInitialIssues(nextInitial.issues);
    setDraftIssues(nextDraftIssues);
    setHasLegacyDraft(legacyDraft !== null);
    setError(null);
    setToast(null);
    setHydratedEditorKey(scopedRoute);
  }, [initialRule, positionId, ruleBookVersion, ruleBookRevision, hydratedEditorKey]);

  const blockingIssues = [...new Set([...initialIssues, ...draftIssues])];
  const formIssues = validateEditorValues(values, true);
  const saveBlocked =
    blockingIssues.length > 0 || formIssues.length > 0 || reason.trim().length < 4 || submitting;

  const scopedRoute = routeFor(positionId, ruleBookVersion);

  useEffect(() => {
    if (hydratedEditorKey !== scopedRoute || blockingIssues.length > 0) return;
    const timer = setTimeout(() => {
      saveDraft(scopedRoute, 'rule', { ...toDraftValues(values), baseRevision });
    }, 500);
    return () => clearTimeout(timer);
  }, [blockingIssues.length, hydratedEditorKey, scopedRoute, values, baseRevision]);

  function discardUnsafeDraft() {
    deleteDraft(scopedRoute, 'rule');
    if (hasLegacyDraft) deleteDraft(legacyRouteFor(positionId), 'rule');
    const nextInitial = decodeInitialRule(initialRule);
    setValues(nextInitial.values);
    setBaseRevision(ruleBookRevision);
    setInitialIssues(nextInitial.issues);
    setDraftIssues([]);
    setHasLegacyDraft(false);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (blockingIssues.length > 0) {
      setError('This rule requires review before it can be saved.');
      return;
    }
    if (formIssues.length > 0) {
      setError(formIssues[0] ?? 'Complete the rule form before saving.');
      return;
    }
    if (reason.trim().length < 4) {
      setError('Enter a reason of at least 4 characters.');
      return;
    }
    if (values.ruleId === null) {
      setError('Set a valid rule ID before saving.');
      return;
    }

    setSubmitting(true);
    const fingerprint = JSON.stringify({ values, baseRevision, reason: reason.trim() });
    if (pendingSave.current?.fingerprint !== fingerprint)
      pendingSave.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        `/api/admin/rules/${values.ruleId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': pendingSave.current.key,
          },
          credentials: 'include',
          body: JSON.stringify({
            expected_rule_book_revision: baseRevision ?? undefined,
            required_criteria: {
              rank: values.requiredRanks,
              credentials: lineValues(values.requiredCredentials),
              ...(values.anyOfCredentials.length
                ? { anyOfCredentials: values.anyOfCredentials }
                : {}),
              ...(values.service.length ? { service: values.service } : {}),
              ...(values.postAward.length ? { postAward: values.postAward } : {}),
              custom: values.customCriteria,
            },
            points_preference: {
              max: values.scoring ? 0 : Number(values.maxPoints),
              items: values.scoring
                ? []
                : values.pointRows.map((row) => ({
                    credential: row.credential.trim(),
                    points: Number(row.points),
                    ...(row.opsGate === '' ? {} : { opsGate: row.opsGate }),
                  })),
              ...(values.scoring ? { scoring: values.scoring } : {}),
            },
            tie_break_chain: values.tieBreakChain,
            reason_code: 'rule_override.fix_misconfig',
            reason: reason.trim(),
          }),
        },
      );
      if (response.status === 401) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === 'step_up_required'
            ? 'Session stale — please re-authenticate.'
            : 'Auth failed.',
        );
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (${response.status})`);
        return;
      }
      deleteDraft(scopedRoute, 'rule');
      const saved = (await response.json()) as { ruleBookRevision?: number };
      if (saved.ruleBookRevision !== undefined) setBaseRevision(saved.ruleBookRevision);
      setReason('');
      setToast('Rule saved');
      pendingSave.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        invalidateWorkingBidBoards(queryClient, ['upcoming']),
        queryClient.invalidateQueries({ queryKey: ['admin', 'rules'] }),
      ]);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Save response unavailable. Your draft and retry key are retained.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6">
      <p className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">
        Editing draft rule <span className="font-mono text-slate-100">#{initialRule.id}</span> for{' '}
        <span className="font-mono text-slate-100">{positionId}</span> in configured rule book{' '}
        <span className="font-mono text-slate-100">{ruleBookVersion}</span>.
      </p>

      {ruleBookRevision != null && baseRevision != null && ruleBookRevision !== baseRevision && (
        <div role="alert" className="rounded border border-amber-600 p-3 text-sm text-amber-100">
          <p>
            The rule book changed while this edit was open. Your values remain here; saving the
            stale revision will be rejected.
          </p>
          <button
            type="button"
            onClick={discardUnsafeDraft}
            className="mt-2 min-h-11 rounded border border-amber-600 px-3"
          >
            Discard local edits and load current rule
          </button>
        </div>
      )}

      {blockingIssues.length > 0 && (
        <aside
          role="alert"
          className="rounded border border-amber-600 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          <p className="font-semibold">Rule requires review; saving is disabled.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p className="mt-2">No changes will be sent until this is resolved.</p>
          {draftIssues.length > 0 && (
            <button
              type="button"
              onClick={discardUnsafeDraft}
              className="mt-3 rounded border border-amber-300 px-3 py-1.5 text-sm text-amber-50 hover:bg-amber-900/40"
            >
              Discard unsafe local draft
            </button>
          )}
        </aside>
      )}

      <fieldset className="rounded border border-slate-700 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-100">Required ranks</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {RANKS.map((rank) => (
            <label key={rank} className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={values.requiredRanks.includes(rank)}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    requiredRanks: updateList(current.requiredRanks, rank, event.target.checked),
                  }))
                }
              />
              {RANK_LABELS[rank]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-semibold text-slate-100">Required credential names</span>
        <span className="mt-1 block text-sm text-slate-300">
          Enter one exact credential name per line, exactly as they appear in credential records.
        </span>
        <textarea
          data-testid="rule-required-credentials"
          value={values.requiredCredentials}
          onChange={(event) =>
            setValues((current) => ({ ...current, requiredCredentials: event.target.value }))
          }
          rows={4}
          className="mt-2 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
        />
      </label>

      <QualificationAlternativesEditor
        value={values.anyOfCredentials}
        onChange={(anyOfCredentials) => setValues((current) => ({ ...current, anyOfCredentials }))}
      />
      <ServiceRequirementsEditor
        value={values.service}
        onChange={(service) => setValues((current) => ({ ...current, service }))}
      />
      <PostAwardObligationsEditor
        value={values.postAward}
        onChange={(postAward) => setValues((current) => ({ ...current, postAward }))}
      />
      <fieldset className="rounded border border-slate-700 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-100">
          Custom eligibility conditions
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CUSTOM_CRITERIA.map((criterion) => (
            <label key={criterion} className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={values.customCriteria.includes(criterion)}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    customCriteria: updateList(
                      current.customCriteria,
                      criterion,
                      event.target.checked,
                    ),
                  }))
                }
              />
              {CUSTOM_CRITERIA_LABELS[criterion]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={values.scoring !== null}
          onChange={(e) =>
            setValues((current) => ({
              ...current,
              scoring: e.target.checked ? { v: 1, total: [], so: [], mo: [] } : null,
            }))
          }
        />
        Use explicit Total, Special Operations, and Marine scoring for this draft rule
      </label>
      {values.scoring && (
        <ConfiguredScoringEditor
          value={values.scoring}
          onChange={(scoring) => setValues((current) => ({ ...current, scoring }))}
        />
      )}
      {!values.scoring && (
        <fieldset className="rounded border border-slate-700 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-100">Credential points</legend>
          <label className="mt-2 block max-w-xs">
            <span className="text-sm text-slate-300">Maximum points</span>
            <span className="mt-1 block text-xs text-slate-400">Use 0 for no points cap.</span>
            <input
              data-testid="rule-max-points"
              type="number"
              min="0"
              step="1"
              value={values.maxPoints}
              onChange={(event) =>
                setValues((current) => ({ ...current, maxPoints: event.target.value }))
              }
              className="mt-2 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
            />
          </label>

          <div className="mt-4 space-y-3">
            {values.pointRows.map((row, index) => (
              <div
                key={row.clientId}
                className="grid gap-3 rounded border border-slate-700 p-3 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto]"
              >
                <label className="block">
                  <span className="text-xs text-slate-300">Credential name</span>
                  <input
                    data-testid={`rule-points-row-${index}-credential`}
                    type="text"
                    value={row.credential}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        pointRows: current.pointRows.map((currentRow, currentIndex) =>
                          currentIndex === index
                            ? { ...currentRow, credential: event.target.value }
                            : currentRow,
                        ),
                      }))
                    }
                    className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-300">Points</span>
                  <input
                    data-testid={`rule-points-row-${index}-points`}
                    type="number"
                    min="0"
                    step="1"
                    value={row.points}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        pointRows: current.pointRows.map((currentRow, currentIndex) =>
                          currentIndex === index
                            ? { ...currentRow, points: event.target.value }
                            : currentRow,
                        ),
                      }))
                    }
                    className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-300">Operations gate (optional)</span>
                  <select
                    data-testid={`rule-points-row-${index}-ops-gate`}
                    value={row.opsGate}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        pointRows: current.pointRows.map((currentRow, currentIndex) =>
                          currentIndex === index
                            ? { ...currentRow, opsGate: event.target.value as OpsGate | '' }
                            : currentRow,
                        ),
                      }))
                    }
                    className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
                  >
                    <option value="">No Operations gate</option>
                    {OPS_GATES.map((gate) => (
                      <option key={gate} value={gate}>
                        {OPS_GATE_LABELS[gate]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setValues((current) => ({
                      ...current,
                      pointRows: current.pointRows.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    }))
                  }
                  className="self-end rounded border border-slate-500 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            data-testid="rule-add-points-row"
            type="button"
            onClick={() =>
              setValues((current) => ({
                ...current,
                pointRows: [...current.pointRows, createNextPointRow(current.pointRows)],
              }))
            }
            className="mt-4 rounded border border-slate-500 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            Add credential points
          </button>
        </fieldset>
      )}

      <fieldset className="rounded border border-slate-700 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-100">Tie-break order</legend>
        <p className="mt-1 text-sm text-slate-300">Selections are evaluated in this order.</p>
        <ol className="mt-3 space-y-2">
          {values.tieBreakChain.map((key, index) => (
            <li
              key={key}
              data-testid={`rule-tie-break-item-${key}`}
              className="flex flex-wrap items-center gap-2 rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              <span className="w-6 tabular-nums text-slate-400">{index + 1}.</span>
              <span className="min-w-40 flex-1">{TIE_BREAK_LABELS[key]}</span>
              <button
                type="button"
                aria-label={`Move ${TIE_BREAK_LABELS[key]} earlier`}
                disabled={index === 0}
                onClick={() =>
                  setValues((current) => {
                    if (index === 0) return current;
                    const next = [...current.tieBreakChain];
                    const previous = next[index - 1];
                    if (!previous) return current;
                    next[index - 1] = key;
                    next[index] = previous;
                    return { ...current, tieBreakChain: next };
                  })
                }
                className="rounded border border-slate-500 px-2 py-1 disabled:opacity-50"
              >
                Earlier
              </button>
              <button
                type="button"
                aria-label={`Move ${TIE_BREAK_LABELS[key]} later`}
                disabled={index === values.tieBreakChain.length - 1}
                onClick={() =>
                  setValues((current) => {
                    if (index === current.tieBreakChain.length - 1) return current;
                    const next = [...current.tieBreakChain];
                    const following = next[index + 1];
                    if (!following) return current;
                    next[index] = following;
                    next[index + 1] = key;
                    return { ...current, tieBreakChain: next };
                  })
                }
                className="rounded border border-slate-500 px-2 py-1 disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="button"
                aria-label={`Remove ${TIE_BREAK_LABELS[key]} from tie-break order`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    tieBreakChain: current.tieBreakChain.filter((item) => item !== key),
                  }))
                }
                className="rounded border border-slate-500 px-2 py-1"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <label className="mt-4 block max-w-md">
          <span className="text-sm text-slate-300">Add a tie-break selection</span>
          <select
            data-testid="rule-tie-break-add"
            value=""
            onChange={(event) => {
              const key = event.target.value;
              if (!isTieBreakKey(key) || values.tieBreakChain.includes(key)) return;
              setValues((current) => ({
                ...current,
                tieBreakChain: [...current.tieBreakChain, key],
              }));
            }}
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
          >
            <option value="">Choose a tie-break</option>
            {TIE_BREAK_KEYS.filter((key) => !values.tieBreakChain.includes(key)).map((key) => (
              <option key={key} value={key}>
                {TIE_BREAK_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="block">
        <span className="text-sm text-slate-300">Reason (min 4 chars)</span>
        <textarea
          data-testid="rule-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
          required
        />
      </label>

      {blockingIssues.length === 0 && formIssues.length > 0 && (
        <output aria-live="polite" className="block text-sm text-amber-300">
          {formIssues[0]}
        </output>
      )}
      {error !== null && (
        <output aria-live="polite" className="block text-sm text-red-400">
          {error}
        </output>
      )}
      {toast !== null && (
        <output aria-live="polite" className="block text-sm text-emerald-400">
          {toast}
        </output>
      )}

      <button
        data-testid="rule-save"
        type="submit"
        disabled={saveBlocked}
        className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
      >
        Save rule
      </button>
    </form>
  );
}
