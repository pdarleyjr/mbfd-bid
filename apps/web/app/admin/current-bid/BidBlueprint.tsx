'use client';

import { Button } from '@/components/ui/button';
import type { BidDefinitionContent, BidImpactResponse } from '@mbfd/shared';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import type { BidPreview } from './bid-client';
import {
  BID_VISUAL_LENSES,
  type BidVisualImpact,
  type BidVisualLens,
  type BidVisualNode,
  buildBidVisualModel,
  selectBidVisualLens,
} from './bid-visual-model';

const lensLabels: Record<BidVisualLens, string> = {
  overview: 'Overview',
  flow: 'Flow',
  policy: 'Policy',
  specialty: 'Specialty',
  opportunities: 'Opportunities',
  members: 'Members',
  changes: 'Changes',
};

const groupOrder = [
  'policy',
  'authoring',
  'flow',
  'specialty',
  'opportunities',
  'members',
  'analysis',
  'changes',
  'unresolved',
] as const;

const statusClass: Record<BidVisualNode['status'], string> = {
  AUTHORED: 'border-muted-foreground bg-muted/40',
  READY: 'border-border bg-background',
  CHANGED: 'border-primary bg-primary/10',
  BLOCKED: 'border-destructive bg-destructive/10',
  UNRESOLVED: 'border-destructive bg-destructive/10',
  NOT_EVALUATED: 'border-muted-foreground bg-muted',
};

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

function serverFactLabel(impact: BidVisualImpact) {
  const source =
    impact.source === 'PREVIEW'
      ? 'Server Preview'
      : impact.mode === 'live'
        ? 'Live server impact'
        : impact.mode === 'mock'
          ? 'Mock server impact'
          : 'Server impact';
  return `${source} · ${statusLabel(impact.status)}`;
}

function summaryFor(node: BidVisualNode) {
  const detail = node.impact
    ? [
        node.impact.evaluatedMemberCount === undefined
          ? null
          : `${node.impact.evaluatedMemberCount} evaluated`,
        node.impact.eligibleMemberCount === undefined
          ? null
          : `${node.impact.eligibleMemberCount} eligible`,
        node.impact.changeCount === undefined ? null : `${node.impact.changeCount} changes`,
      ]
        .filter((value): value is string => value !== null)
        .join(' · ')
    : '';
  return detail ? `${node.summary} ${detail}.` : node.summary;
}

function visibleGroups(nodes: readonly BidVisualNode[]) {
  const present = new Set(nodes.map((node) => node.group));
  return groupOrder.filter((group) => present.has(group));
}

function nodeLayout(nodes: readonly BidVisualNode[]) {
  const groups = visibleGroups(nodes);
  const positions = new Map<string, { x: number; y: number }>();
  const heightByGroup = new Map<string, number>();
  for (const [groupIndex, group] of groups.entries()) {
    const inGroup = nodes
      .filter((node) => node.group === group)
      .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
    heightByGroup.set(group, inGroup.length);
    for (const [index, node] of inGroup.entries()) {
      positions.set(node.id, { x: 24 + groupIndex * 232, y: 40 + index * 114 });
    }
  }
  return {
    groups,
    positions,
    width: Math.max(720, groups.length * 232 + 24),
    height: Math.max(260, Math.max(0, ...heightByGroup.values()) * 114 + 48),
  };
}

function edgePath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const startX = source.x + 184;
  const startY = source.y + 38;
  const endX = target.x;
  const endY = target.y + 38;
  const midpoint = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} C ${midpoint} ${startY}, ${midpoint} ${endY}, ${endX} ${endY}`;
}

/**
 * A small deterministic graph renderer intentionally avoids a new graph
 * runtime: the model carries authored/local configuration plus separately
 * supplied server facts, has stable IDs, and is bounded by lens. Native buttons
 * retain keyboard and screen-reader operation, while the SVG carries only
 * decorative relationship lines.
 */
export function BidBlueprint({
  content,
  preview,
  impact,
}: {
  content: BidDefinitionContent;
  preview?: BidPreview | null;
  impact?: BidImpactResponse | null;
}) {
  const model = useMemo(
    () =>
      buildBidVisualModel({
        content,
        ...(preview ? { preview } : {}),
        ...(impact ? { impact } : {}),
      }),
    [content, preview, impact],
  );
  const [lens, setLens] = useState<BidVisualLens>('overview');
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedProjection = selectBidVisualLens(model, lens);
  const projection = selectedProjection.projection;
  const displayedIds = new Set(showAll ? projection.nodeIds : projection.defaultNodeIds);
  const displayedNodes = selectedProjection.nodes.filter((node) => displayedIds.has(node.id));
  const displayedEdges = selectedProjection.edges.filter(
    (edge) =>
      (showAll ? projection.edgeIds : projection.defaultEdgeIds).includes(edge.id) &&
      displayedIds.has(edge.source) &&
      displayedIds.has(edge.target),
  );
  const layout = nodeLayout(displayedNodes);
  const selected =
    displayedNodes.find((node) => node.id === selectedId) ?? displayedNodes.at(0) ?? null;
  const zoomScale = zoom / 100;

  const changeLens = (next: BidVisualLens) => {
    setLens(next);
    setShowAll(false);
    setSelectedId(null);
  };

  const tabId = (candidate: BidVisualLens) => `bid-blueprint-tab-${candidate}`;
  const panelId = (candidate: BidVisualLens) => `bid-blueprint-panel-${candidate}`;
  const onLensKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % BID_VISUAL_LENSES.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + BID_VISUAL_LENSES.length) % BID_VISUAL_LENSES.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = BID_VISUAL_LENSES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextLens = BID_VISUAL_LENSES[nextIndex];
    if (!nextLens) return;
    changeLens(nextLens);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 id="bid-blueprint-heading" className="font-semibold">
          Bid relationship map
        </h3>
        <p className="text-sm text-muted-foreground">
          This view shows authored/local Bid structure and separately labeled server Preview or
          impact facts. It does not calculate policy, eligibility, priority, or staffing outcomes in
          the browser.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Bid Blueprint lenses"
        aria-orientation="horizontal"
        className="flex flex-wrap gap-2"
      >
        {BID_VISUAL_LENSES.map((candidate, index) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={tabId(candidate)}
            aria-selected={lens === candidate}
            aria-controls={panelId(candidate)}
            tabIndex={lens === candidate ? 0 : -1}
            className="min-h-11 rounded border border-border px-3 text-sm aria-selected:border-primary aria-selected:bg-primary/10"
            onClick={() => changeLens(candidate)}
            onKeyDown={(event) => onLensKeyDown(event, index)}
          >
            {lensLabels[candidate]}
          </button>
        ))}
      </div>

      {BID_VISUAL_LENSES.map((candidate) => (
        <div
          key={candidate}
          id={panelId(candidate)}
          role="tabpanel"
          aria-labelledby={tabId(candidate)}
          hidden={lens !== candidate}
          className="space-y-4"
        >
          {lens === candidate ? (
            <>
              <div
                className="flex flex-wrap items-center gap-2"
                aria-label="Bid relationship map controls"
              >
                <Button
                  type="button"
                  variant="default"
                  aria-label="Zoom out Bid relationship map"
                  disabled={zoom <= 70}
                  onClick={() => setZoom((value) => Math.max(70, value - 10))}
                >
                  <Minus aria-hidden="true" size={16} />
                  Zoom out
                </Button>
                <Button
                  type="button"
                  variant="default"
                  aria-label="Zoom in Bid relationship map"
                  disabled={zoom >= 140}
                  onClick={() => setZoom((value) => Math.min(140, value + 10))}
                >
                  <Plus aria-hidden="true" size={16} />
                  Zoom in
                </Button>
                <Button
                  type="button"
                  variant="default"
                  aria-label="Reset zoom for Bid relationship map"
                  disabled={zoom === 100}
                  onClick={() => setZoom(100)}
                >
                  <RotateCcw aria-hidden="true" size={16} />
                  Reset zoom
                </Button>
                <output aria-live="polite" className="text-sm text-muted-foreground">
                  Zoom: {zoom}%
                </output>
                {projection.hiddenNodeCount > 0 && (
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => setShowAll((value) => !value)}
                  >
                    {showAll
                      ? 'Show focused map'
                      : `Show all ${projection.nodeIds.length} ${projection.label.toLowerCase()} nodes`}
                  </Button>
                )}
              </div>

              <section
                id={`bid-blueprint-${lens}`}
                aria-label="Bid relationship map"
                aria-describedby="bid-blueprint-map-help"
                className="max-h-[35rem] overflow-auto rounded border border-border bg-muted/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p id="bid-blueprint-map-help" className="mb-3 text-xs text-muted-foreground">
                  Use the lens controls to change the view, scroll to pan, zoom controls to scale,
                  and Tab to select a node for its inspector. Node status identifies authored/local
                  structure or an attached server fact. Relationship lines are visual only; the
                  structured list below contains the same data.
                </p>
                {displayedNodes.length ? (
                  <div
                    style={{ width: layout.width * zoomScale, height: layout.height * zoomScale }}
                  >
                    <div
                      className="relative motion-reduce:transform-none"
                      style={{
                        width: layout.width,
                        height: layout.height,
                        transform: `scale(${zoomScale})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <svg
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                        viewBox={`0 0 ${layout.width} ${layout.height}`}
                      >
                        {displayedEdges.map((edge) => {
                          const source = layout.positions.get(edge.source);
                          const target = layout.positions.get(edge.target);
                          if (!source || !target) return null;
                          return (
                            <path
                              key={edge.id}
                              d={edgePath(source, target)}
                              fill="none"
                              stroke="currentColor"
                              strokeDasharray={edge.status === 'UNRESOLVED' ? '5 4' : undefined}
                              className={
                                edge.status === 'UNRESOLVED'
                                  ? 'text-destructive opacity-80'
                                  : edge.status === 'CHANGED'
                                    ? 'text-primary opacity-80'
                                    : 'text-muted-foreground opacity-55'
                              }
                              strokeWidth="1.5"
                            />
                          );
                        })}
                      </svg>
                      {displayedNodes.map((node) => {
                        const point = layout.positions.get(node.id);
                        if (!point) return null;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            data-bid-visual-node
                            aria-pressed={selected?.id === node.id}
                            aria-label={`${node.label}. ${statusLabel(node.status)}.${node.impact ? ` ${serverFactLabel(node.impact)}.` : ''} ${summaryFor(node)}`}
                            className={`absolute min-h-[76px] w-44 rounded border p-2 text-left text-sm shadow-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring ${statusClass[node.status]} ${selected?.id === node.id ? 'ring-2 ring-ring' : ''}`}
                            style={{ left: point.x, top: point.y }}
                            onClick={() => setSelectedId(node.id)}
                          >
                            <span className="block break-words font-medium">{node.label}</span>
                            <span className="mt-1 block text-[0.65rem] font-semibold uppercase tracking-wide">
                              {statusLabel(node.status)}
                            </span>
                            <span className="line-clamp-2 block text-xs text-muted-foreground">
                              {summaryFor(node)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p>No safe relationships are available for this lens.</p>
                )}
              </section>

              <section
                aria-label="Blueprint inspector"
                className="rounded border border-border p-3"
              >
                <h4 className="font-medium">Blueprint inspector</h4>
                {selected ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <p>
                      <strong>{selected.label}</strong> · {statusLabel(selected.status)}
                    </p>
                    <p>{summaryFor(selected)}</p>
                    {selected.impact && <p>Server fact: {serverFactLabel(selected.impact)}</p>}
                    <p className="break-words text-muted-foreground">
                      Provenance:{' '}
                      {selected.provenance.length
                        ? selected.provenance.join(' · ')
                        : 'Not supplied'}
                    </p>
                    {selected.impact?.code && <p>Analysis code: {selected.impact.code}</p>}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Select a relationship node to inspect it.
                  </p>
                )}
              </section>

              <details className="rounded border border-border p-3">
                <summary className="min-h-11 cursor-pointer content-center font-medium">
                  Structured relationship list
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  Equivalent non-graph data for the {projection.label.toLowerCase()} lens.
                </p>
                <ul className="mt-3 space-y-3 text-sm">
                  {selectedProjection.nodes.map((node) => {
                    const relationships = selectedProjection.edges.filter(
                      (edge) => edge.source === node.id || edge.target === node.id,
                    );
                    return (
                      <li key={node.id} className="rounded border border-border p-3">
                        <p>
                          <strong>{node.label}</strong> · {statusLabel(node.status)}
                        </p>
                        <p>{summaryFor(node)}</p>
                        {node.impact && <p>Server fact: {serverFactLabel(node.impact)}</p>}
                        <p className="break-words text-xs text-muted-foreground">
                          Provenance:{' '}
                          {node.provenance.length ? node.provenance.join(' · ') : 'Not supplied'}
                        </p>
                        {relationships.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                            {relationships.map((edge) => (
                              <li key={edge.id}>
                                {edge.source === node.id ? 'To' : 'From'}{' '}
                                {edge.source === node.id ? edge.target : edge.source}:{' '}
                                {edge.relationship} · {edge.status.replaceAll('_', ' ')}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
