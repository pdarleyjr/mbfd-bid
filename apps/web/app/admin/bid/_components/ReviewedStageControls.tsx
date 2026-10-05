'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useState } from 'react';
import type { PositionMeta } from '../../../_components/bid/types';
import { ReviewedBidAdjustment } from './ReviewedBidAdjustment';

export type StageControlsMetadata = {
  allowed: boolean;
  stages: Array<{ id: string; label: string; completed: boolean }>;
  current_stage_id: string | null;
  withdrawable_position_ids: string[];
  withdrawn_position_ids: string[];
};

/** Generic reviewed stage and open-opportunity adjustments. The server supplies
 * the exact editable IDs and validates the final change against the same pins. */
export function ReviewedStageControls({
  sessionId,
  sequence,
  metadata,
  positions,
  reason,
  disabled,
  onSaved,
}: {
  sessionId: string;
  sequence: number;
  metadata: StageControlsMetadata;
  positions: readonly PositionMeta[];
  reason: string;
  disabled: boolean;
  onSaved(): void;
}) {
  const [stageId, setStageId] = useState(metadata.current_stage_id ?? '');
  const [completePriorStages, setCompletePriorStages] = useState(false);
  const [withdraw, setWithdraw] = useState<string[]>([]);
  const [restore, setRestore] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  if (!metadata.allowed || metadata.stages.length === 0) return null;
  const selectedIndex = metadata.stages.findIndex((stage) => stage.id === stageId);
  const currentIndex = metadata.stages.findIndex((stage) => stage.id === metadata.current_stage_id);
  const targetAllowed =
    stageId === metadata.current_stage_id ||
    (currentIndex >= 0 &&
      selectedIndex > currentIndex &&
      metadata.stages[selectedIndex]?.completed === false);
  const earlierStages = metadata.stages.slice(0, Math.max(0, selectedIndex));
  const hasEarlierStage = earlierStages.some((stage) => !stage.completed);
  const stageValid = selectedIndex >= 0 && targetAllowed;
  const positionsValid =
    withdraw.every((id) => metadata.withdrawable_position_ids.includes(id)) &&
    restore.every((id) => metadata.withdrawn_position_ids.includes(id));
  const hasChange =
    stageId !== metadata.current_stage_id ||
    (completePriorStages && hasEarlierStage) ||
    withdraw.length > 0 ||
    restore.length > 0;
  const blocked = disabled || !stageValid || !positionsValid || !hasChange;
  const search = query.trim().toLocaleLowerCase();
  const positionLabel = (id: string) => {
    const position = positions.find((candidate) => candidate.id === id);
    return position ? `${id} · ${position.unit} · ${position.positionName}` : id;
  };
  function toggle(id: string, selected: string[], update: (ids: string[]) => void) {
    update(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }
  function choices(
    ids: string[],
    selected: string[],
    update: (ids: string[]) => void,
    action: 'Withdraw' | 'Restore',
  ) {
    const shown = ids.filter(
      (id) => !search || positionLabel(id).toLocaleLowerCase().includes(search),
    );
    return (
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">
          {action === 'Withdraw' ? 'Withdraw open positions' : 'Restore withdrawn positions'}
        </legend>
        <div className="mt-1 max-h-48 overflow-y-auto">
          {shown.map((id) => (
            <Label key={id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`${action} ${id}`}
                checked={selected.includes(id)}
                disabled={disabled}
                onChange={() => toggle(id, selected, update)}
              />
              {positionLabel(id)}
            </Label>
          ))}
          {shown.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No matching positions.</p>
          ) : null}
        </div>
      </fieldset>
    );
  }
  return (
    <details className="mt-4 border-t border-border pt-2">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        Adjust stage and open positions
      </summary>
      <Label className="mt-2 block text-sm">
        Bid stage
        <NativeSelect
          aria-label="Bid stage"
          className="mt-1"
          value={stageId}
          disabled={disabled}
          onChange={(event) => setStageId(event.target.value)}
        >
          <option value="">Select stage</option>
          {metadata.stages.map((stage, index) => (
            <option
              key={stage.id}
              value={stage.id}
              disabled={
                stage.id !== metadata.current_stage_id &&
                (stage.completed || currentIndex < 0 || index < currentIndex)
              }
            >
              {stage.label}
              {stage.completed ? ' · Completed' : ''}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <Label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="Complete earlier stages"
          checked={completePriorStages}
          disabled={disabled || !hasEarlierStage}
          onChange={(event) => setCompletePriorStages(event.target.checked)}
        />
        Complete earlier stages
      </Label>
      <p className="text-xs text-muted-foreground">
        Recorded selections stay saved. Completing a stage ends its remaining turns and A-Day
        requests.
      </p>
      <Label className="mt-3 block text-sm">
        Find positions
        <Input
          aria-label="Find positions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Position, unit or role"
          className="mt-1"
        />
      </Label>
      {choices(metadata.withdrawable_position_ids, withdraw, setWithdraw, 'Withdraw')}
      {metadata.withdrawn_position_ids.length
        ? choices(metadata.withdrawn_position_ids, restore, setRestore, 'Restore')
        : null}
      {withdraw.length + restore.length > 0 ? (
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span>
            {withdraw.length} to withdraw · {restore.length} to restore
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setWithdraw([]);
              setRestore([]);
            }}
          >
            Clear positions
          </Button>
        </div>
      ) : null}
      {!stageValid ? (
        <p role="alert" className="mt-2 text-sm text-warning">
          The bid stage changed. Choose the current stage or a later stage.
        </p>
      ) : !positionsValid ? (
        <p role="alert" className="mt-2 text-sm text-warning">
          A selected opening changed. Clear positions and review the current choices.
        </p>
      ) : null}
      <ReviewedBidAdjustment
        sessionId={sessionId}
        sequence={sequence}
        detail={{
          type: 'live.transition_stage',
          stageId,
          completePriorStages,
          ...(withdraw.length ? { withdrawOpenPositionIds: [...withdraw].sort() } : {}),
          ...(restore.length ? { restoreOpenPositionIds: [...restore].sort() } : {}),
        }}
        reason={reason}
        disabled={blocked}
        label="Stage adjustment"
        onSaved={() => {
          setWithdraw((current) => current.filter((id) => !withdraw.includes(id)));
          setRestore((current) => current.filter((id) => !restore.includes(id)));
          setCompletePriorStages(false);
          onSaved();
        }}
      />
    </details>
  );
}
