import type { BidDefinitionContent, BidImpactResponse } from '@mbfd/shared';
import type { BidPreview } from './bid-client';

/**
 * A renderer-facing projection of authored Bid material and server analysis.
 * It intentionally owns no eligibility, scoring, ordering, or policy logic.
 */
export const BID_VISUAL_LENSES = [
  'overview',
  'flow',
  'policy',
  'specialty',
  'opportunities',
  'members',
  'changes',
] as const;
export type BidVisualLens = (typeof BID_VISUAL_LENSES)[number];

/** A renderer may render this many graph elements initially, then expose the rest accessibly. */
export const BID_VISUAL_DEFAULT_NODE_LIMIT = 24;

export type BidVisualStatus =
  | 'AUTHORED'
  | 'READY'
  | 'CHANGED'
  | 'BLOCKED'
  | 'UNRESOLVED'
  | 'NOT_EVALUATED';
export type BidVisualGroup =
  | 'policy'
  | 'flow'
  | 'authoring'
  | 'specialty'
  | 'opportunities'
  | 'members'
  | 'changes'
  | 'analysis'
  | 'unresolved';
export type BidVisualNodeType =
  | 'policy'
  | 'flow'
  | 'stage'
  | 'participant-source'
  | 'profile'
  | 'rule'
  | 'opportunity'
  | 'participation'
  | 'staffing-binding'
  | 'source-decision'
  | 'specialty'
  | 'requirement'
  | 'member'
  | 'aggregate'
  | 'analysis'
  | 'change'
  | 'unresolved';
export type BidVisualRelationship =
  | 'contains'
  | 'flows-to'
  | 'governs'
  | 'applies-to'
  | 'offers'
  | 'participates-in'
  | 'binds'
  | 'uses'
  | 'requires'
  | 'specializes'
  | 'evaluates'
  | 'changes';

/** Facts supplied by a preview or impact response. Values are copied, never calculated here. */
export interface BidVisualImpact {
  source: 'PREVIEW' | 'IMPACT';
  status: 'VALID' | 'INVALID' | 'EVALUATED' | 'BLOCKED' | 'UNAVAILABLE';
  mode?: 'mock' | 'live';
  contentSha256?: string;
  impactSha256?: string | null;
  capturedAtMs?: number;
  changedSections?: readonly string[];
  evaluatedMemberCount?: number;
  eligibleMemberCount?: number;
  changeCount?: number;
  code?: string;
}

export interface BidVisualNode {
  id: string;
  type: BidVisualNodeType;
  label: string;
  summary: string;
  provenance: readonly string[];
  status: BidVisualStatus;
  /** Stable category and layer for a simple directed-layout renderer. */
  group: BidVisualGroup;
  rank: number;
  impact?: BidVisualImpact;
}

export interface BidVisualEdge {
  id: string;
  source: string;
  target: string;
  relationship: BidVisualRelationship;
  status: BidVisualStatus;
  group: BidVisualGroup;
  rank: number;
  impact?: BidVisualImpact;
}

export interface BidVisualLensProjection {
  lens: BidVisualLens;
  label: string;
  /** Every applicable element, in stable order, for virtualized lists and drilldown. */
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  /** The bounded initial graph. No information is discarded from nodeIds/edgeIds. */
  defaultNodeIds: readonly string[];
  defaultEdgeIds: readonly string[];
  hiddenNodeCount: number;
}

export interface BidVisualModel {
  nodes: readonly BidVisualNode[];
  edges: readonly BidVisualEdge[];
  lenses: Readonly<Record<BidVisualLens, BidVisualLensProjection>>;
}

export interface BuildBidVisualModelInput {
  content: BidDefinitionContent;
  /** Already validated server preview data for this exact draft, if available. */
  preview?: BidPreview | null;
  /** Already validated server impact data for this Bid year, if available. */
  impact?: BidImpactResponse | null;
}

export interface BidVisualLensSelection {
  projection: BidVisualLensProjection;
  nodes: readonly BidVisualNode[];
  edges: readonly BidVisualEdge[];
}

type EntityKind =
  | 'stage'
  | 'position'
  | 'rule'
  | 'profile'
  | 'specialty'
  | 'member'
  | 'participation'
  | 'binding'
  | 'decision';

type PendingMemberReference = { stageId: string; memberId: number };
type StageParticipantSourceDefinition = NonNullable<
  NonNullable<BidDefinitionContent['policy']>['stageParticipantSources']
>[number];

const groupRank: Record<BidVisualGroup, number> = {
  policy: 0,
  flow: 1,
  authoring: 2,
  specialty: 3,
  opportunities: 4,
  members: 5,
  analysis: 6,
  changes: 7,
  unresolved: 8,
};

const lensLabels: Record<BidVisualLens, string> = {
  overview: 'Overview',
  flow: 'Flow',
  policy: 'Policy',
  specialty: 'Specialty',
  opportunities: 'Opportunities',
  members: 'Members',
  changes: 'Changes',
};

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function byNodeOrder(left: BidVisualNode, right: BidVisualNode): number {
  return (
    left.rank - right.rank ||
    compareText(left.group, right.group) ||
    compareText(left.label, right.label) ||
    compareText(left.id, right.id)
  );
}

function byEdgeOrder(left: BidVisualEdge, right: BidVisualEdge): number {
  return (
    left.rank - right.rank ||
    compareText(left.group, right.group) ||
    compareText(left.source, right.source) ||
    compareText(left.relationship, right.relationship) ||
    compareText(left.target, right.target) ||
    compareText(left.id, right.id)
  );
}

function segment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function entityKey(kind: EntityKind, value: string | number): string {
  return `${kind}:${String(value)}`;
}

function sourceReference(value: string | null | undefined, fallback = 'Bid definition'): string[] {
  return value === null || value === undefined || value.length === 0 ? [fallback] : [value];
}

/** Field-order-insensitive structural equality is only a stale-result guard, not a policy calculation. */
function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort(compareText);
  const rightKeys = Object.keys(rightRecord).sort(compareText);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJson(leftRecord[key], rightRecord[key]),
    )
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function stableOrder<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareText(key(left), key(right)));
}

function scopeSummary(
  scope: NonNullable<BidDefinitionContent['authoring']>['profiles'][number]['scope'],
): string {
  switch (scope.kind) {
    case 'department':
      return 'Department-wide scope';
    case 'rank':
      return `Rank scope: ${scope.rank}`;
    case 'station_shift':
      return `Station ${scope.station}, shift ${scope.shift}`;
    case 'family':
      return `Family scope: ${scope.name}`;
    case 'position':
      return `Position scope: ${scope.positionId}`;
  }
}

function participantSourceSummary(definition: StageParticipantSourceDefinition): string {
  const source = definition.participantSource;
  const sourceDetail =
    source.type === 'FILTER'
      ? `Active BIDDABLE ranks: ${stableOrder(source.ranks, (rank) => rank).join(', ')}.`
      : `Explicit member IDs: ${stableOrder(source.memberIds, (memberId) =>
          String(memberId).padStart(12, '0'),
        ).join(', ')}.`;
  const ordering = definition.ordering.map((rule) => `${rule.key} ${rule.direction}`).join(' → ');
  return `${sourceDetail} Ordering: ${ordering}.`;
}

class VisualModelBuilder {
  private readonly nodes: BidVisualNode[] = [];
  private readonly edges: BidVisualEdge[] = [];
  private readonly nodeById = new Map<string, BidVisualNode>();
  private readonly edgeIds = new Set<string>();
  private readonly entities = new Map<string, string[]>();
  readonly pendingMemberReferences: PendingMemberReference[] = [];

  addNode(node: Omit<BidVisualNode, 'rank'> & { rank?: number }): BidVisualNode {
    let id = node.id;
    let duplicate = 2;
    while (this.nodeById.has(id)) id = `${node.id}~${duplicate++}`;
    const value: BidVisualNode = {
      ...node,
      id,
      rank: node.rank ?? groupRank[node.group],
    };
    this.nodes.push(value);
    this.nodeById.set(id, value);
    return value;
  }

  addEntity(kind: EntityKind, identity: string | number, node: BidVisualNode): void {
    const key = entityKey(kind, identity);
    const known = this.entities.get(key) ?? [];
    known.push(node.id);
    this.entities.set(key, known);
  }

  resolve(kind: EntityKind, identity: string | number): string | undefined {
    const matches = this.entities.get(entityKey(kind, identity)) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  }

  resolveCount(kind: EntityKind, identity: string | number): number {
    return (this.entities.get(entityKey(kind, identity)) ?? []).length;
  }

  addEdge(
    source: string,
    target: string,
    relationship: BidVisualRelationship,
    status: BidVisualStatus,
    group: BidVisualGroup,
    impact?: BidVisualImpact,
  ): BidVisualEdge {
    const baseId = `edge:${source}:${relationship}:${target}`;
    const known = this.edges.find((edge) => edge.id === baseId);
    if (known) return known;
    const value: BidVisualEdge = {
      id: baseId,
      source,
      target,
      relationship,
      status,
      group,
      rank: groupRank[group],
      ...(impact ? { impact } : {}),
    };
    this.edges.push(value);
    this.edgeIds.add(value.id);
    return value;
  }

  unresolved(
    scope: string,
    identifiers: readonly (string | number)[],
    label: string,
    summary: string,
    provenance: readonly string[] = ['Bid definition'],
  ): BidVisualNode {
    const id = `unresolved:${scope}:${identifiers.map(segment).join(':')}`;
    return (
      this.nodeById.get(id) ??
      this.addNode({
        id,
        type: 'unresolved',
        label,
        summary,
        provenance,
        status: 'UNRESOLVED',
        group: 'unresolved',
      })
    );
  }

  reference(
    source: string,
    kind: EntityKind,
    identity: string | number,
    relationship: BidVisualRelationship,
    group: BidVisualGroup,
    options: {
      unresolvedScope: string;
      unresolvedIdentifiers: readonly (string | number)[];
      unresolvedLabel: string;
      provenance?: readonly string[];
      impact?: BidVisualImpact;
    },
  ): string {
    const target = this.resolve(kind, identity);
    if (target) {
      this.addEdge(
        source,
        target,
        relationship,
        options.impact ? 'READY' : 'AUTHORED',
        group,
        options.impact,
      );
      return target;
    }
    const count = this.resolveCount(kind, identity);
    const targetNode = this.unresolved(
      options.unresolvedScope,
      options.unresolvedIdentifiers,
      options.unresolvedLabel,
      count === 0
        ? `${options.unresolvedLabel} has no matching configured node.`
        : `${options.unresolvedLabel} maps to multiple configured nodes.`,
      options.provenance,
    );
    this.addEdge(source, targetNode.id, relationship, 'UNRESOLVED', 'unresolved', options.impact);
    return targetNode.id;
  }

  markChanged(nodeId: string | undefined, impact: BidVisualImpact): void {
    if (!nodeId) return;
    const node = this.nodeById.get(nodeId);
    if (!node || node.status === 'UNRESOLVED' || node.status === 'BLOCKED') return;
    node.status = 'CHANGED';
    if (!node.impact || node.impact.source === impact.source)
      node.impact = { ...node.impact, ...impact };
  }

  setImpact(nodeId: string | undefined, impact: BidVisualImpact): void {
    if (!nodeId) return;
    const node = this.nodeById.get(nodeId);
    if (!node || node.status === 'UNRESOLVED') return;
    node.impact = impact;
  }

  getNode(id: string): BidVisualNode | undefined {
    return this.nodeById.get(id);
  }

  orderedNodes(): BidVisualNode[] {
    return [...this.nodes].sort(byNodeOrder);
  }

  orderedEdges(): BidVisualEdge[] {
    return [...this.edges].sort(byEdgeOrder);
  }
}

function addStructuralNodes(builder: VisualModelBuilder, content: BidDefinitionContent): void {
  const policyNode = builder.addNode({
    id: 'policy:bid',
    type: 'policy',
    label: 'Policy & language',
    summary: content.policy ? content.policy.policyText : 'No execution policy is configured.',
    provenance: content.policy
      ? [`Policy revision ${content.policy.executionPolicy.policyRevision}`]
      : ['Bid definition'],
    status: content.policy ? 'AUTHORED' : 'UNRESOLVED',
    group: 'policy',
  });
  const flowNode = builder.addNode({
    id: 'flow:bid',
    type: 'flow',
    label: 'Bid flow',
    summary: content.policy
      ? `${content.policy.executionPolicy.stages.length} configured stages.`
      : 'No configured stage flow is available.',
    provenance: policyNode.provenance,
    status: content.policy ? 'AUTHORED' : 'UNRESOLVED',
    group: 'flow',
  });
  builder.addEdge(policyNode.id, flowNode.id, 'flows-to', flowNode.status, 'flow');

  const opportunityAggregate = builder.addNode({
    id: 'aggregate:opportunities',
    type: 'aggregate',
    label: 'Opportunities',
    summary: `${content.positions.length} configured opportunities.`,
    provenance: ['Bid definition'],
    status: 'AUTHORED',
    group: 'opportunities',
  });
  builder.addEdge(flowNode.id, opportunityAggregate.id, 'contains', 'AUTHORED', 'flow');

  const stageMemberCount =
    content.policy?.executionPolicy.stages.reduce(
      (total, stage) => total + stage.memberIds.length,
      0,
    ) ?? 0;
  const memberAggregate = builder.addNode({
    id: 'aggregate:members',
    type: 'aggregate',
    label: 'Configured participant references',
    summary: `${stageMemberCount} configured stage-member references; identities require server analysis.`,
    provenance: content.policy ? policyNode.provenance : ['Bid definition'],
    status: 'NOT_EVALUATED',
    group: 'members',
  });
  builder.addEdge(flowNode.id, memberAggregate.id, 'contains', memberAggregate.status, 'flow');

  const specialtyCount = content.policy?.executionPolicy.annualOperations?.specialties?.length ?? 0;
  const specialtyAggregate = builder.addNode({
    id: 'aggregate:specialty',
    type: 'aggregate',
    label: 'Specialty policy',
    summary: `${specialtyCount} configured specialty policies.`,
    provenance: content.policy ? policyNode.provenance : ['Bid definition'],
    status: content.policy?.executionPolicy.annualOperations ? 'AUTHORED' : 'NOT_EVALUATED',
    group: 'specialty',
  });
  builder.addEdge(
    policyNode.id,
    specialtyAggregate.id,
    'contains',
    specialtyAggregate.status,
    'policy',
  );

  const changeAggregate = builder.addNode({
    id: 'aggregate:changes',
    type: 'aggregate',
    label: 'Draft changes',
    summary: 'No server preview or impact result has been attached.',
    provenance: ['Server analysis required'],
    status: 'NOT_EVALUATED',
    group: 'changes',
  });
  builder.addEdge(policyNode.id, changeAggregate.id, 'contains', changeAggregate.status, 'policy');

  for (const position of stableOrder(
    content.positions,
    (value) => `${value.id}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `opportunity:${segment(position.id)}`,
      type: 'opportunity',
      label: position.positionName,
      summary: `${position.station} · ${position.shift} shift · ${position.unit} · ${position.rankRequired}`,
      provenance: ['Bid definition'],
      status: 'AUTHORED',
      group: 'opportunities',
    });
    builder.addEntity('position', position.id, node);
    builder.addEdge(opportunityAggregate.id, node.id, 'contains', 'AUTHORED', 'opportunities');
  }

  for (const rule of stableOrder(
    content.rules,
    (value) => `${value.positionId}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `rule:${segment(rule.positionId)}`,
      type: 'rule',
      label: `Rule for ${rule.positionId}`,
      summary: rule.notes ?? 'Configured opportunity rule.',
      provenance: ['Bid definition'],
      status: 'AUTHORED',
      group: 'authoring',
    });
    builder.addEntity('rule', rule.positionId, node);
    builder.reference(node.id, 'position', rule.positionId, 'governs', 'authoring', {
      unresolvedScope: 'rule-position',
      unresolvedIdentifiers: [rule.positionId],
      unresolvedLabel: `UNRESOLVED opportunity ${rule.positionId}`,
    });
  }

  for (const row of stableOrder(
    content.participation,
    (value) => `${value.positionId}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `participation:${segment(row.positionId)}`,
      type: 'participation',
      label: row.bidParticipation,
      summary: `Explicit participation for ${row.positionId}.`,
      provenance: sourceReference(row.authoritativeSourceRef),
      status: 'AUTHORED',
      group: 'policy',
    });
    builder.addEntity('participation', row.positionId, node);
    builder.reference(node.id, 'position', row.positionId, 'participates-in', 'policy', {
      unresolvedScope: 'participation-position',
      unresolvedIdentifiers: [row.positionId],
      unresolvedLabel: `UNRESOLVED opportunity ${row.positionId}`,
      provenance: node.provenance,
    });
  }

  for (const binding of stableOrder(
    content.staffingBindings,
    (value) => `${value.positionId}\u0000${value.staffingPositionId}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `binding:${segment(binding.positionId)}:${segment(binding.staffingPositionId)}`,
      type: 'staffing-binding',
      label: `Staffing binding ${binding.staffingPositionId}`,
      summary: `Review status: ${binding.reviewStatus}.`,
      provenance: sourceReference(binding.authoritativeSourceRef),
      status: binding.reviewStatus === 'approved' ? 'AUTHORED' : 'BLOCKED',
      group: 'policy',
    });
    builder.addEntity('binding', binding.positionId, node);
    builder.reference(node.id, 'position', binding.positionId, 'binds', 'policy', {
      unresolvedScope: 'binding-position',
      unresolvedIdentifiers: [binding.positionId, binding.staffingPositionId],
      unresolvedLabel: `UNRESOLVED opportunity ${binding.positionId}`,
      provenance: node.provenance,
    });
  }

  for (const decision of stableOrder(
    content.sourceDecisions,
    (value) => `${value.issueId}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `decision:${segment(decision.issueId)}`,
      type: 'source-decision',
      label: decision.title,
      summary: decision.question,
      provenance: sourceReference(decision.sourceRef),
      status: decision.status === 'RESOLVED' ? 'AUTHORED' : 'BLOCKED',
      group: 'policy',
    });
    builder.addEntity('decision', decision.issueId, node);
    builder.addEdge(policyNode.id, node.id, 'contains', node.status, 'policy');
  }

  if (!content.authoring) return;

  for (const profile of stableOrder(
    content.authoring.profiles,
    (value) => `${value.id}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `profile:${segment(profile.id)}`,
      type: 'profile',
      label: profile.name,
      summary: scopeSummary(profile.scope),
      provenance: sourceReference(profile.sourceRef),
      status: 'AUTHORED',
      group: 'authoring',
    });
    builder.addEntity('profile', profile.id, node);
    const explicitPositions =
      profile.scope.kind === 'position'
        ? [profile.scope.positionId]
        : profile.scope.kind === 'family'
          ? profile.scope.positionIds
          : [];
    for (const positionId of explicitPositions) {
      builder.reference(node.id, 'position', positionId, 'applies-to', 'authoring', {
        unresolvedScope: 'profile-position',
        unresolvedIdentifiers: [profile.id, positionId],
        unresolvedLabel: `UNRESOLVED opportunity ${positionId}`,
        provenance: node.provenance,
      });
    }
  }

  for (const compiled of stableOrder(
    content.authoring.compiled,
    (value) => `${value.rule.positionId}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `compiled-rule:${segment(compiled.rule.positionId)}`,
      type: 'rule',
      label: `Compiled rule for ${compiled.rule.positionId}`,
      summary: `Compilation reconciliation: ${content.authoring.reconciliation}.`,
      provenance: ['Captured annual rule compilation'],
      status: 'AUTHORED',
      group: 'authoring',
    });
    builder.reference(node.id, 'position', compiled.rule.positionId, 'governs', 'authoring', {
      unresolvedScope: 'compiled-rule-position',
      unresolvedIdentifiers: [compiled.rule.positionId],
      unresolvedLabel: `UNRESOLVED opportunity ${compiled.rule.positionId}`,
      provenance: node.provenance,
    });
    builder.reference(node.id, 'rule', compiled.rule.positionId, 'uses', 'authoring', {
      unresolvedScope: 'compiled-rule-rule',
      unresolvedIdentifiers: [compiled.rule.positionId],
      unresolvedLabel: `UNRESOLVED rule ${compiled.rule.positionId}`,
      provenance: node.provenance,
    });
    for (const profileId of [
      ...compiled.provenance.requirements,
      ...compiled.provenance.scoring,
      ...compiled.provenance.priorities,
      ...compiled.provenance.matched,
    ]) {
      builder.reference(node.id, 'profile', profileId, 'uses', 'authoring', {
        unresolvedScope: 'compiled-profile',
        unresolvedIdentifiers: [compiled.rule.positionId, profileId],
        unresolvedLabel: `UNRESOLVED profile ${profileId}`,
        provenance: node.provenance,
      });
    }
  }

  if (!content.policy) return;
  const execution = content.policy.executionPolicy;
  for (const stage of stableOrder(
    execution.stages,
    (value) =>
      `${String(value.order).padStart(8, '0')}\u0000${value.id}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `stage:${segment(stage.id)}`,
      type: 'stage',
      label: stage.label,
      summary: `${stage.kind} · ${stage.memberIds.length} participant references · ${stage.opportunityPositionIds.length} opportunities.`,
      provenance: [`Policy revision ${execution.policyRevision}`],
      status: 'AUTHORED',
      group: 'flow',
      rank: groupRank.flow + stage.order / 1000,
    });
    builder.addEntity('stage', stage.id, node);
    builder.addEdge(flowNode.id, node.id, 'flows-to', 'AUTHORED', 'flow');
    for (const positionId of stage.opportunityPositionIds) {
      builder.reference(node.id, 'position', positionId, 'offers', 'flow', {
        unresolvedScope: 'stage-opportunity',
        unresolvedIdentifiers: [stage.id, positionId],
        unresolvedLabel: `UNRESOLVED opportunity ${positionId}`,
        provenance: node.provenance,
      });
    }
    for (const memberId of stage.memberIds) {
      builder.pendingMemberReferences.push({ stageId: stage.id, memberId });
    }
  }

  for (const definition of stableOrder(
    content.policy.stageParticipantSources ?? [],
    (value) => `${value.stageId}\u0000${canonicalJson(value)}`,
  )) {
    const stage = builder.resolve('stage', definition.stageId);
    const node = builder.addNode({
      id: `stage-participant-source:${segment(definition.stageId)}`,
      type: 'participant-source',
      label: `${definition.participantSource.type} participant source`,
      summary: participantSourceSummary(definition),
      provenance: sourceReference(definition.sourceRef),
      status: stage ? 'AUTHORED' : 'UNRESOLVED',
      group: 'flow',
      rank: groupRank.flow + 0.5,
    });
    builder.reference(node.id, 'stage', definition.stageId, 'governs', 'flow', {
      unresolvedScope: 'participant-source-stage',
      unresolvedIdentifiers: [definition.stageId],
      unresolvedLabel: `UNRESOLVED stage ${definition.stageId}`,
      provenance: node.provenance,
    });
  }

  for (const specialty of stableOrder(
    execution.annualOperations?.specialties ?? [],
    (value) => `${value.id}\u0000${canonicalJson(value)}`,
  )) {
    const node = builder.addNode({
      id: `specialty:${segment(specialty.id)}`,
      type: 'specialty',
      label: specialty.label,
      summary: `${specialty.mode} specialty policy.`,
      provenance: sourceReference(
        execution.specialtyCatalogReference,
        `Policy revision ${execution.policyRevision}`,
      ),
      status: 'AUTHORED',
      group: 'specialty',
    });
    builder.addEntity('specialty', specialty.id, node);
    builder.addEdge(specialtyAggregate.id, node.id, 'contains', 'AUTHORED', 'specialty');
    for (const credential of stableOrder(specialty.requiredCredentialNames, (value) => value)) {
      const requirement = builder.addNode({
        id: `specialty-requirement:${segment(specialty.id)}:credential:${segment(credential)}`,
        type: 'requirement',
        label: credential,
        summary: 'Configured specialty credential requirement.',
        provenance: node.provenance,
        status: 'AUTHORED',
        group: 'specialty',
      });
      builder.addEdge(requirement.id, node.id, 'requires', 'AUTHORED', 'specialty');
    }
    for (const code of stableOrder(specialty.requiredSpecialtyCodes, (value) => value)) {
      const requirement = builder.addNode({
        id: `specialty-requirement:${segment(specialty.id)}:code:${segment(code)}`,
        type: 'requirement',
        label: code,
        summary: 'Configured specialty qualification code.',
        provenance: node.provenance,
        status: 'AUTHORED',
        group: 'specialty',
      });
      builder.addEdge(requirement.id, node.id, 'requires', 'AUTHORED', 'specialty');
    }
    for (const positionId of stableOrder(specialty.opportunityPositionIds, (value) => value)) {
      builder.reference(node.id, 'position', positionId, 'specializes', 'specialty', {
        unresolvedScope: 'specialty-opportunity',
        unresolvedIdentifiers: [specialty.id, positionId],
        unresolvedLabel: `UNRESOLVED opportunity ${positionId}`,
        provenance: node.provenance,
      });
    }
  }
}

type DiffSection = 'positions' | 'rules' | 'participation' | 'staffingBindings' | 'sourceDecisions';
const diffEntityKinds: Record<DiffSection, EntityKind> = {
  positions: 'position',
  rules: 'rule',
  participation: 'participation',
  staffingBindings: 'binding',
  sourceDecisions: 'decision',
};

function addDiff(
  builder: VisualModelBuilder,
  rootId: string,
  diff: {
    positions: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
    rules: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
    participation: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
    staffingBindings: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
    sourceDecisions: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
    changedSections: string[];
  },
  origin: 'preview' | 'impact',
  impact: BidVisualImpact,
): void {
  for (const section of Object.keys(diffEntityKinds) as DiffSection[]) {
    const changeSet = diff[section];
    for (const change of ['added', 'removed', 'changed'] as const) {
      const ids = changeSet[`${change}Ids`];
      for (const identity of ids) {
        const changeNode = builder.addNode({
          id: `change:${origin}:${section}:${change}:${segment(identity)}`,
          type: 'change',
          label: `${change === 'added' ? 'Added' : change === 'removed' ? 'Removed' : 'Changed'} ${section}: ${identity}`,
          summary: `Server ${origin} reports this ${change} ${section} record.`,
          provenance: [origin === 'preview' ? 'Server preview' : 'Server impact analysis'],
          status: 'CHANGED',
          group: 'changes',
          impact,
        });
        builder.addEdge(rootId, changeNode.id, 'changes', 'CHANGED', 'changes', impact);
        const target = builder.resolve(diffEntityKinds[section], identity);
        if (target) {
          builder.addEdge(changeNode.id, target, 'changes', 'CHANGED', 'changes', impact);
          builder.markChanged(target, impact);
        } else if (change !== 'removed') {
          const unresolved = builder.unresolved(
            `${origin}-diff`,
            [section, identity],
            `UNRESOLVED ${section} ${identity}`,
            `The server ${origin} references a ${section} record not represented by this visual model.`,
            changeNode.provenance,
          );
          builder.addEdge(
            changeNode.id,
            unresolved.id,
            'changes',
            'UNRESOLVED',
            'unresolved',
            impact,
          );
        }
      }
    }
  }
}

function addPreview(
  builder: VisualModelBuilder,
  content: BidDefinitionContent,
  preview: BidPreview | null | undefined,
): void {
  if (!preview) return;
  const aggregate = builder.getNode('aggregate:changes');
  if (!preview.valid) {
    const root = builder.addNode({
      id: 'analysis:preview',
      type: 'analysis',
      label: 'Server preview blocked',
      summary: `${preview.issues.length} server validation issue(s).`,
      provenance: ['Server preview'],
      status: 'BLOCKED',
      group: 'analysis',
      impact: { source: 'PREVIEW', status: 'INVALID' },
    });
    if (aggregate) builder.addEdge(aggregate.id, root.id, 'contains', 'BLOCKED', 'analysis');
    for (const [index, issue] of preview.issues.entries()) {
      const issueNode = builder.addNode({
        id: `analysis:preview-issue:${index}`,
        type: 'analysis',
        label: issue.code,
        summary: issue.message,
        provenance: ['Server preview'],
        status: 'BLOCKED',
        group: 'analysis',
        impact: { source: 'PREVIEW', status: 'INVALID', code: issue.code },
      });
      builder.addEdge(root.id, issueNode.id, 'contains', 'BLOCKED', 'analysis');
    }
    return;
  }

  if (!sameJson(content, preview.content)) {
    const context = builder.addNode({
      id: 'analysis:preview-context',
      type: 'analysis',
      label: 'Preview context is unresolved',
      summary: 'The supplied preview describes a different draft and is not applied to this model.',
      provenance: ['Server preview'],
      status: 'UNRESOLVED',
      group: 'analysis',
      impact: { source: 'PREVIEW', status: 'UNAVAILABLE', contentSha256: preview.contentSha256 },
    });
    if (aggregate)
      builder.addEdge(aggregate.id, context.id, 'contains', 'UNRESOLVED', 'unresolved');
    return;
  }

  const metadata: BidVisualImpact = {
    source: 'PREVIEW',
    status: 'VALID',
    contentSha256: preview.contentSha256,
    changedSections: preview.diff.changedSections,
  };
  const root = builder.addNode({
    id: 'analysis:preview',
    type: 'analysis',
    label: 'Server preview',
    summary: preview.wouldCreateVersion
      ? 'The server preview would create a new Bid version.'
      : 'The server preview reports no new Bid version.',
    provenance: [`Content ${preview.contentSha256}`],
    status: 'READY',
    group: 'analysis',
    impact: metadata,
  });
  if (aggregate) {
    aggregate.status = preview.diff.changedSections.length ? 'CHANGED' : 'READY';
    aggregate.summary = preview.diff.changedSections.length
      ? `Server preview reports changes in: ${preview.diff.changedSections.join(', ')}.`
      : 'Server preview reports no changed sections.';
    aggregate.impact = metadata;
    builder.addEdge(aggregate.id, root.id, 'contains', aggregate.status, 'analysis', metadata);
  }
  addDiff(builder, root.id, preview.diff, 'preview', metadata);
}

function impactStatus(
  impact: Extract<BidImpactResponse, { valid: true }>,
): BidVisualImpact['status'] {
  return impact.after.status === 'EVALUATED' ? 'EVALUATED' : 'BLOCKED';
}

function addImpact(
  builder: VisualModelBuilder,
  content: BidDefinitionContent,
  response: BidImpactResponse | null | undefined,
): void {
  if (!response) return;
  const aggregate = builder.getNode('aggregate:changes');
  if (!response.valid) {
    const root = builder.addNode({
      id: 'analysis:impact',
      type: 'analysis',
      label: 'Server impact blocked',
      summary: `${response.issues.length} server validation issue(s).`,
      provenance: ['Server impact analysis'],
      status: 'BLOCKED',
      group: 'analysis',
      impact: { source: 'IMPACT', status: 'INVALID' },
    });
    if (aggregate) builder.addEdge(aggregate.id, root.id, 'contains', 'BLOCKED', 'analysis');
    for (const [index, issue] of response.issues.entries()) {
      const issueNode = builder.addNode({
        id: `analysis:impact-issue:${index}`,
        type: 'analysis',
        label: issue.code,
        summary: issue.message,
        provenance: ['Server impact analysis'],
        status: 'BLOCKED',
        group: 'analysis',
        impact: { source: 'IMPACT', status: 'INVALID', code: issue.code },
      });
      builder.addEdge(root.id, issueNode.id, 'contains', 'BLOCKED', 'analysis');
    }
    return;
  }
  if (response.bidYear !== content.bidYear) {
    const context = builder.addNode({
      id: 'analysis:impact-context',
      type: 'analysis',
      label: 'Impact context is unresolved',
      summary: 'The supplied server impact belongs to another Bid year and is not applied.',
      provenance: ['Server impact analysis'],
      status: 'UNRESOLVED',
      group: 'analysis',
      impact: {
        source: 'IMPACT',
        status: 'UNAVAILABLE',
        mode: response.mode,
        impactSha256: response.impactSha256,
      },
    });
    if (aggregate)
      builder.addEdge(aggregate.id, context.id, 'contains', 'UNRESOLVED', 'unresolved');
    return;
  }

  const metadata: BidVisualImpact = {
    source: 'IMPACT',
    status: impactStatus(response),
    mode: response.mode,
    impactSha256: response.impactSha256,
    capturedAtMs: response.capturedAtMs,
    changedSections: response.diff.changedSections,
  };
  const root = builder.addNode({
    id: 'analysis:impact',
    type: 'analysis',
    label: `${response.mode === 'mock' ? 'Mock' : 'Live'} server impact`,
    summary:
      response.after.status === 'EVALUATED'
        ? 'Server analysis evaluated the configured Bid context.'
        : `Server analysis is blocked: ${response.after.code}.`,
    provenance: [
      `Baseline ${response.source.baselineContentSha256}`,
      `Candidate ${response.source.candidateContentSha256}`,
      `Runtime ${response.runtimeSourceToken}`,
    ],
    status: response.after.status === 'EVALUATED' ? 'READY' : 'BLOCKED',
    group: 'analysis',
    impact: metadata,
  });
  if (aggregate) {
    aggregate.status = response.after.status === 'EVALUATED' ? 'CHANGED' : 'BLOCKED';
    aggregate.summary =
      response.after.status === 'EVALUATED'
        ? 'Authoritative server impact is available.'
        : `Authoritative server impact is blocked: ${response.after.code}.`;
    aggregate.impact = metadata;
    builder.addEdge(aggregate.id, root.id, 'contains', aggregate.status, 'analysis', metadata);
  }
  addDiff(builder, root.id, response.diff, 'impact', metadata);

  if (response.after.status !== 'EVALUATED') return;
  for (const member of response.after.members) {
    const node = builder.addNode({
      id: `member:${segment(member.memberId)}`,
      type: 'member',
      label: member.displayName ?? `Member ${member.memberId}`,
      summary: `${member.rank} · ${member.pool} pool.`,
      provenance: [`Runtime ${response.runtimeSourceToken}`],
      status: 'READY',
      group: 'members',
      impact: metadata,
    });
    builder.addEntity('member', member.memberId, node);
    builder.addEdge(root.id, node.id, 'evaluates', 'READY', 'analysis', metadata);
  }

  for (const opportunity of response.after.opportunities) {
    const opportunityImpact: BidVisualImpact = {
      ...metadata,
      evaluatedMemberCount: opportunity.evaluatedMemberCount,
      eligibleMemberCount: opportunity.eligibleMemberCount,
    };
    const target = builder.reference(
      root.id,
      'position',
      opportunity.positionId,
      'evaluates',
      'analysis',
      {
        unresolvedScope: 'impact-opportunity',
        unresolvedIdentifiers: [opportunity.positionId],
        unresolvedLabel: `UNRESOLVED opportunity ${opportunity.positionId}`,
        provenance: root.provenance,
        impact: opportunityImpact,
      },
    );
    builder.setImpact(target, opportunityImpact);
  }

  if (response.after.stageOrder.status === 'EVALUATED') {
    for (const entry of response.after.stageOrder.entries) {
      const stage = builder.resolve('stage', entry.stageId);
      const source =
        stage ??
        builder.unresolved(
          'impact-stage',
          [entry.stageId],
          `UNRESOLVED stage ${entry.stageId}`,
          'Server analysis references a stage not represented by this visual model.',
          root.provenance,
        ).id;
      builder.reference(source, 'member', entry.memberId, 'participates-in', 'members', {
        unresolvedScope: 'impact-stage-member',
        unresolvedIdentifiers: [entry.stageId, entry.memberId],
        unresolvedLabel: `UNRESOLVED member ${entry.memberId}`,
        provenance: root.provenance,
        impact: metadata,
      });
    }
  }

  for (const specialty of response.after.specialties) {
    const source = builder.resolve('specialty', specialty.id);
    const specialtyNode =
      source ??
      builder.unresolved(
        'impact-specialty',
        [specialty.id],
        `UNRESOLVED specialty ${specialty.id}`,
        'Server analysis references a specialty not represented by this visual model.',
        root.provenance,
      ).id;
    builder.addEdge(
      root.id,
      specialtyNode,
      'evaluates',
      source ? 'READY' : 'UNRESOLVED',
      source ? 'analysis' : 'unresolved',
      metadata,
    );
    for (const candidate of specialty.candidates) {
      builder.reference(specialtyNode, 'member', candidate.memberId, 'specializes', 'specialty', {
        unresolvedScope: 'impact-specialty-member',
        unresolvedIdentifiers: [specialty.id, candidate.memberId],
        unresolvedLabel: `UNRESOLVED member ${candidate.memberId}`,
        provenance: root.provenance,
        impact: metadata,
      });
    }
  }

  if (response.comparison.status !== 'EVALUATED') {
    root.impact = { ...metadata, status: 'UNAVAILABLE', code: response.comparison.code };
    return;
  }
  root.impact = { ...metadata, changeCount: response.comparison.eligibility.changeCount };
  for (const [index, change] of response.comparison.eligibility.changes.entries()) {
    const changeImpact: BidVisualImpact = {
      ...metadata,
      changeCount: response.comparison.eligibility.changeCount,
      code: change.cause,
    };
    const node = builder.addNode({
      id: `change:eligibility:${segment(change.positionId)}:${segment(change.memberId)}:${index}`,
      type: 'change',
      label: `Eligibility change for member ${change.memberId}`,
      summary: `${change.cause} change at ${change.positionId}, reported by the server.`,
      provenance: root.provenance,
      status: 'CHANGED',
      group: 'changes',
      impact: changeImpact,
    });
    builder.addEdge(root.id, node.id, 'changes', 'CHANGED', 'changes', changeImpact);
    const position = builder.reference(
      node.id,
      'position',
      change.positionId,
      'changes',
      'changes',
      {
        unresolvedScope: 'impact-change-opportunity',
        unresolvedIdentifiers: [change.positionId, change.memberId],
        unresolvedLabel: `UNRESOLVED opportunity ${change.positionId}`,
        provenance: root.provenance,
        impact: changeImpact,
      },
    );
    const member = builder.reference(node.id, 'member', change.memberId, 'changes', 'changes', {
      unresolvedScope: 'impact-change-member',
      unresolvedIdentifiers: [change.positionId, change.memberId],
      unresolvedLabel: `UNRESOLVED member ${change.memberId}`,
      provenance: root.provenance,
      impact: changeImpact,
    });
    builder.markChanged(position, changeImpact);
    builder.markChanged(member, changeImpact);
  }
}

function resolveConfiguredStageMembers(builder: VisualModelBuilder): void {
  for (const pending of builder.pendingMemberReferences) {
    const stage = builder.resolve('stage', pending.stageId);
    if (!stage) continue;
    builder.reference(stage, 'member', pending.memberId, 'participates-in', 'members', {
      unresolvedScope: 'stage-member',
      unresolvedIdentifiers: [pending.stageId, pending.memberId],
      unresolvedLabel: `UNRESOLVED member ${pending.memberId}`,
      provenance: ['Configured stage reference'],
    });
  }
}

function nodeMatchesLens(lens: BidVisualLens, node: BidVisualNode): boolean {
  // A failed reference is operationally material in every view; do not let a lens hide it.
  if (node.status === 'UNRESOLVED') return true;
  switch (lens) {
    case 'overview':
      return (
        node.type === 'policy' ||
        node.type === 'flow' ||
        node.type === 'stage' ||
        node.type === 'participant-source' ||
        node.type === 'aggregate' ||
        node.type === 'analysis'
      );
    case 'flow':
      return (
        node.group === 'flow' ||
        node.type === 'policy' ||
        node.id === 'aggregate:opportunities' ||
        node.id === 'aggregate:members' ||
        node.type === 'analysis'
      );
    case 'policy':
      return (
        node.group === 'policy' ||
        node.group === 'authoring' ||
        node.type === 'participant-source' ||
        node.type === 'analysis'
      );
    case 'specialty':
      return (
        node.group === 'specialty' ||
        node.type === 'opportunity' ||
        node.type === 'member' ||
        node.type === 'analysis'
      );
    case 'opportunities':
      return (
        node.group === 'opportunities' ||
        node.type === 'rule' ||
        node.type === 'participation' ||
        node.type === 'staffing-binding' ||
        node.type === 'stage' ||
        node.type === 'specialty' ||
        node.type === 'analysis'
      );
    case 'members':
      return (
        node.group === 'members' ||
        node.type === 'stage' ||
        node.type === 'participant-source' ||
        node.type === 'specialty' ||
        node.type === 'analysis'
      );
    case 'changes':
      return node.group === 'changes' || node.group === 'analysis' || node.status === 'CHANGED';
  }
}

function buildLenses(
  nodes: readonly BidVisualNode[],
  edges: readonly BidVisualEdge[],
): Record<BidVisualLens, BidVisualLensProjection> {
  const projections = {} as Record<BidVisualLens, BidVisualLensProjection>;
  for (const lens of BID_VISUAL_LENSES) {
    const nodeIds = nodes.filter((node) => nodeMatchesLens(lens, node)).map((node) => node.id);
    const visible = new Set(nodeIds);
    const edgeIds = edges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => edge.id);
    const defaultNodeIds = nodeIds.slice(0, BID_VISUAL_DEFAULT_NODE_LIMIT);
    const defaultVisible = new Set(defaultNodeIds);
    const defaultEdgeIds = edges
      .filter((edge) => defaultVisible.has(edge.source) && defaultVisible.has(edge.target))
      .map((edge) => edge.id);
    projections[lens] = {
      lens,
      label: lensLabels[lens],
      nodeIds,
      edgeIds,
      defaultNodeIds,
      defaultEdgeIds,
      hiddenNodeCount: Math.max(0, nodeIds.length - defaultNodeIds.length),
    };
  }
  return projections;
}

/**
 * Builds a deterministic renderer model from authored configuration plus results already calculated
 * by the server. It does not parse rules, infer profile scope, or calculate membership/eligibility.
 */
export function buildBidVisualModel(input: BuildBidVisualModelInput): BidVisualModel {
  const builder = new VisualModelBuilder();
  addStructuralNodes(builder, input.content);
  addPreview(builder, input.content, input.preview);
  addImpact(builder, input.content, input.impact);
  resolveConfiguredStageMembers(builder);
  const nodes = builder.orderedNodes();
  const edges = builder.orderedEdges();
  return { nodes, edges, lenses: buildLenses(nodes, edges) };
}

/** Returns a lens with full ordered data; renderers can use projection.default* for the initial graph. */
export function selectBidVisualLens(
  model: BidVisualModel,
  lens: BidVisualLens,
): BidVisualLensSelection {
  const projection = model.lenses[lens];
  const nodeIds = new Set(projection.nodeIds);
  const edgeIds = new Set(projection.edgeIds);
  return {
    projection,
    nodes: model.nodes.filter((node) => nodeIds.has(node.id)),
    edges: model.edges.filter((edge) => edgeIds.has(edge.id)),
  };
}
