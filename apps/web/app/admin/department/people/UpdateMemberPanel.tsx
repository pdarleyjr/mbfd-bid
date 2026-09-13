'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { DepartmentPerson } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PersonnelWorkspace } from '../../personnel/PersonnelWorkspace';
import { QualificationLifecycleWorkspace } from '../../personnel/qualifications/QualificationLifecycleWorkspace';
import { readCredentialCatalog } from './people-api';

type Interaction = { dirty: boolean; busy: boolean; uncertain: boolean };
type Branch = 'personnel' | 'qualification';
const clean: Interaction = { dirty: false, busy: false, uncertain: false };

export function UpdateMemberPanel({
  person,
  asOf,
  onClose,
}: { person: DepartmentPerson; asOf: string; onClose: () => void }) {
  const [branch, setBranch] = useState<Branch>('personnel');
  const [interaction, setInteraction] = useState<Interaction>(clean);
  const [discardAction, setDiscardAction] = useState<Branch | 'close' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedChanges(interaction.dirty || interaction.uncertain, 'member update');
  const catalog = useQuery({
    queryKey: ['admin', 'credentials'],
    queryFn: ({ signal }) => readCredentialCatalog(signal),
    enabled: branch === 'qualification',
    staleTime: 30_000,
  });
  function leave(action: Branch | 'close') {
    if (interaction.busy || interaction.uncertain) {
      setNotice(
        interaction.uncertain
          ? 'The last request is not yet confirmed. Retry that request here to retrieve its result before leaving.'
          : 'Wait for the current request to finish.',
      );
      return;
    }
    if (interaction.dirty) {
      setDiscardAction(action);
      return;
    }
    setNotice(null);
    if (action === 'close') onClose();
    else setBranch(action);
  }
  function accepted() {
    setInteraction(clean);
    onClose();
  }
  return (
    <TaskPanel
      open
      onClose={() => leave('close')}
      title={`Update member — ${person.firstName} ${person.lastName}`}
      description={`Review an effective-dated change for employee ${person.employeeId}.`}
    >
      {discardAction && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm"
        >
          <p className="font-semibold">Discard the unrecorded changes in this form?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setDiscardAction(null)}>Keep editing</Button>
            <Button
              variant="secondary"
              disabled={interaction.busy || interaction.uncertain}
              onClick={() => {
                if (interaction.busy || interaction.uncertain) return;
                const action = discardAction;
                setDiscardAction(null);
                setInteraction(clean);
                if (action === 'close') onClose();
                else setBranch(action);
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-warning/40 bg-warning-surface p-3 text-sm"
        >
          {notice}
        </p>
      )}
      <fieldset
        disabled={discardAction !== null}
        aria-label="Type of member update"
        className="mb-4 flex flex-wrap gap-2"
      >
        <Button
          aria-pressed={branch === 'personnel'}
          onClick={() => {
            if (branch !== 'personnel') leave('personnel');
          }}
        >
          Employment or assignment
        </Button>
        <Button
          aria-pressed={branch === 'qualification'}
          onClick={() => {
            if (branch !== 'qualification') leave('qualification');
          }}
        >
          Credential change
        </Button>
      </fieldset>
      <fieldset disabled={discardAction !== null} className="min-w-0">
        {branch === 'personnel' ? (
          <PersonnelWorkspace
            focusedMember
            members={[person]}
            memberIdHint={person.id}
            onInteractionState={setInteraction}
            onAccepted={accepted}
            summary={{ asOf }}
          />
        ) : catalog.isPending ? (
          <output>Loading credential definitions…</output>
        ) : catalog.isError ? (
          <div role="alert" className="space-y-3">
            <p>{catalog.error.message}</p>
            <Button
              variant="secondary"
              disabled={catalog.isFetching}
              onClick={() => void catalog.refetch()}
            >
              Retry credential definitions
            </Button>
          </div>
        ) : (
          <QualificationLifecycleWorkspace
            focusedMember
            asOf={asOf}
            members={[{ ...person, rank: person.rank ?? 'CIVILIAN' }]}
            credentials={catalog.data}
            memberIdHint={person.id}
            onInteractionState={setInteraction}
            onAccepted={accepted}
          />
        )}
      </fieldset>
    </TaskPanel>
  );
}
