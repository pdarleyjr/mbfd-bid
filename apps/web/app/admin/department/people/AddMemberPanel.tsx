'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useState } from 'react';
import { PersonnelWorkspace } from '../../personnel/PersonnelWorkspace';
import type { MemberInteractionState } from '../../personnel/focused-member';

export function AddMemberPanel({ asOf, onClose }: { asOf: string; onClose: () => void }) {
  const [interaction, setInteraction] = useState<MemberInteractionState>({
    dirty: false,
    busy: false,
    uncertain: false,
  });
  const [discard, setDiscard] = useState(false);
  const [notice, setNotice] = useState('');
  useUnsavedChanges(
    interaction.dirty || interaction.busy || interaction.uncertain,
    'new member details',
  );
  function close() {
    if (interaction.busy || interaction.uncertain) {
      setNotice(
        interaction.uncertain
          ? 'The last request is not confirmed. Retry the retained request to retrieve its result before leaving.'
          : 'Wait for the current request to finish.',
      );
      return;
    }
    if (interaction.dirty) setDiscard(true);
    else onClose();
  }
  return (
    <TaskPanel
      open
      onClose={close}
      title="Add member"
      description="Record a new employee and the date their employment begins."
    >
      {notice && (
        <p role="alert" className="mb-4 rounded border border-warning/40 p-3 text-sm">
          {notice}
        </p>
      )}
      {discard && (
        <div role="alert" className="mb-4 rounded border border-warning/40 p-3 text-sm">
          <p>Discard these unrecorded member details?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setDiscard(false)}>Keep editing</Button>
            <Button
              variant="secondary"
              disabled={interaction.busy || interaction.uncertain}
              onClick={() => {
                if (!interaction.busy && !interaction.uncertain) onClose();
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      )}
      <fieldset disabled={discard} className="min-w-0">
        <PersonnelWorkspace
          focusedNewHire
          members={[]}
          summary={{ asOf }}
          onInteractionState={setInteraction}
          onAccepted={onClose}
        />
      </fieldset>
    </TaskPanel>
  );
}
