// @vitest-environment jsdom
import type {
  BidDefinitionSourceDecision,
  BidOrderingAuthorityRequest,
  StageParticipantSourceDefinition,
} from '@mbfd/shared';
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BidOrderingAuthorityRequestEditor,
  StageParticipantSourceEditor,
} from '../../app/admin/current-bid/StageParticipantSourceEditor';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const roots: Root[] = [];
const orderingAuthority: Extract<BidOrderingAuthorityRequest, { v: 1 }> = {
  v: 1,
  sourceDecisionId: 'synthetic-annual-policy-decision',
  comparator: [
    { key: 'RSC_SENIORITY', direction: 'ASC' },
    { key: 'RANK_SENIORITY', direction: 'ASC' },
  ],
};

function decision(
  overrides: Partial<BidDefinitionSourceDecision> = {},
): BidDefinitionSourceDecision {
  return {
    issueId: 'synthetic-annual-policy-decision',
    title: 'Synthetic annual policy decision',
    question: 'Which governing comparator is approved?',
    area: 'annual-policy',
    status: 'OPEN',
    decision: 'Pending review',
    sourceRef: 'Synthetic governing policy',
    effectiveOn: '2027-01-15',
    ...overrides,
  };
}

function savedDefinition(): StageParticipantSourceDefinition {
  return {
    stageId: 'stage-one',
    sourceRef: 'Synthetic saved participant authority',
    participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
    ordering: orderingAuthority.comparator,
  };
}

function render(ui: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(ui));
  return container;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function control(scope: HTMLElement, label: string): Control {
  const fields: Control[] = [
    ...scope.querySelectorAll('input'),
    ...scope.querySelectorAll('select'),
    ...scope.querySelectorAll('textarea'),
  ];
  const found = fields.filter((field) =>
    [...(field.labels ?? [])].some((item) => item.textContent?.trim() === label),
  );
  if (found.length !== 1) throw new Error(`Expected one control '${label}', found ${found.length}`);
  const field = found[0];
  if (!field) throw new Error(`Expected control '${label}'`);
  return field;
}
function button(scope: HTMLElement, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].filter(
    (element) => element.textContent?.trim() === text,
  );
  if (found.length !== 1) throw new Error(`Expected one button '${text}', found ${found.length}`);
  const result = found[0];
  if (!result) throw new Error(`Expected button '${text}'`);
  return result;
}
async function click(element: Pick<HTMLElement, 'click'>) {
  await act(async () => element.click());
}
async function setValue(field: Control, value: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StageParticipantSourceEditor', () => {
  it('keeps an unfinished explicit-member draft local and unsaved', async () => {
    const onSave = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={undefined}
        orderingAuthority={orderingAuthority}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    expect(button(container, 'Save participant source').disabled).toBe(true);
    await setValue(control(container, 'Source reference'), 'Synthetic participant authority');
    await setValue(control(container, 'Explicit member IDs'), '901, not-a-member-id');

    expect(container.textContent).toContain(
      'Unresolved local draft — not saved to the Bid definition.',
    );
    expect(button(container, 'Save participant source').disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('persists only a validated explicit-member source with the saved governing comparator', async () => {
    const onSave = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={undefined}
        orderingAuthority={orderingAuthority}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await setValue(control(container, 'Source reference'), 'Synthetic participant authority');
    await setValue(control(container, 'Explicit member IDs'), '901, 999');
    await click(button(container, 'Save participant source'));

    expect(onSave).toHaveBeenCalledWith({
      stageId: 'stage-one',
      sourceRef: 'Synthetic participant authority',
      participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
      ordering: orderingAuthority.comparator,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limits a filter source to affirmative Biddable rank predicates', async () => {
    const onSave = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={undefined}
        orderingAuthority={orderingAuthority}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await setValue(control(container, 'Participant source type'), 'FILTER');
    await setValue(control(container, 'Source reference'), 'Synthetic participant authority');
    await click(control(container, 'FF'));
    await click(button(container, 'Save participant source'));

    expect(onSave).toHaveBeenCalledWith({
      stageId: 'stage-one',
      sourceRef: 'Synthetic participant authority',
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['FF'],
      },
      ordering: orderingAuthority.comparator,
    });
    expect(container.textContent).toContain(
      'No browser roster lookup or Live operation occurs here.',
    );
  });

  it('does not replace a saved source with an incomplete edit and removes it only explicitly', async () => {
    const onSave = vi.fn();
    const onRemove = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={savedDefinition()}
        orderingAuthority={orderingAuthority}
        onSave={onSave}
        onRemove={onRemove}
      />,
    );

    await setValue(control(container, 'Source reference'), 'x');
    expect(container.textContent).toContain('The saved participant source remains unchanged.');
    expect(onSave).not.toHaveBeenCalled();
    await click(button(container, 'Remove saved participant source'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('marks a saved selector stale after a comparator change and requires review before re-save', async () => {
    const onSave = vi.fn();
    const changedAuthority: BidOrderingAuthorityRequest = {
      ...orderingAuthority,
      comparator: [{ key: 'RANK_SENIORITY', direction: 'DESC' }],
    };
    const saved = savedDefinition();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={saved}
        orderingAuthority={changedAuthority}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('Saved selector ordering is stale and unresolved');
    expect(button(container, 'Save participant source').disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await click(button(container, 'Review current governing comparator'));
    expect(button(container, 'Save participant source').disabled).toBe(false);
    await click(button(container, 'Save participant source'));
    expect(onSave).toHaveBeenCalledWith({ ...saved, ordering: changedAuthority.comparator });
  });

  it('keeps an unfinished local draft when a parent recreates an equal saved source', async () => {
    function Parent() {
      const [recreated, setRecreated] = useState(false);
      return (
        <>
          <ButtonForTest onClick={() => setRecreated(true)}>
            Recreate equal saved source
          </ButtonForTest>
          <StageParticipantSourceEditor
            stageId="stage-one"
            savedDefinition={recreated ? structuredClone(savedDefinition()) : savedDefinition()}
            orderingAuthority={orderingAuthority}
            onSave={vi.fn()}
            onRemove={vi.fn()}
          />
        </>
      );
    }

    const container = render(<Parent />);
    await setValue(control(container, 'Source reference'), 'Local unsaved participant authority');
    await click(button(container, 'Recreate equal saved source'));
    expect(control(container, 'Source reference')).toHaveProperty(
      'value',
      'Local unsaved participant authority',
    );
  });

  it('blocks persistence when no governing comparator request has been saved', async () => {
    const onSave = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={undefined}
        orderingAuthority={undefined}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await setValue(control(container, 'Source reference'), 'Synthetic participant authority');
    await setValue(control(container, 'Explicit member IDs'), '901');
    expect(button(container, 'Save participant source').disabled).toBe(true);
    expect(container.textContent).toContain('A saved governing comparator request is required');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks persistence when a saved request no longer targets an annual-policy decision', async () => {
    const onSave = vi.fn();
    const container = render(
      <StageParticipantSourceEditor
        stageId="stage-one"
        savedDefinition={undefined}
        orderingAuthority={orderingAuthority}
        orderingAuthorityAvailable={false}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await setValue(control(container, 'Source reference'), 'Synthetic participant authority');
    await setValue(control(container, 'Explicit member IDs'), '901');
    expect(button(container, 'Save participant source').disabled).toBe(true);
    expect(container.textContent).toContain(
      'no longer points to an available annual-policy source decision',
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});

function ButtonForTest({ children, onClick }: { children: React.ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}

describe('BidOrderingAuthorityRequestEditor', () => {
  it.each(['TIME_IN_GRADE_BID_ORDINAL', 'DEPARTMENT_SERVICE_BID_ORDINAL'])(
    'preserves the distinct reviewed %s channel without translating to legacy seniority',
    async (key) => {
      const onChange = vi.fn();
      const container = render(
        <BidOrderingAuthorityRequestEditor
          sourceDecisions={[decision()]}
          value={undefined}
          onChange={onChange}
        />,
      );
      await setValue(
        control(container, 'Governing source decision'),
        'synthetic-annual-policy-decision',
      );
      await setValue(control(container, 'Primary comparator key'), key);
      await setValue(control(container, 'Primary comparator direction'), 'DESC');
      await click(button(container, 'Save governing comparator request'));
      expect(onChange).toHaveBeenCalledWith({
        v: 1,
        sourceDecisionId: 'synthetic-annual-policy-decision',
        comparator: [{ key, direction: 'DESC' }],
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('saves an explicit unverified request only after a source decision and comparator are selected', async () => {
    const onChange = vi.fn();
    const container = render(
      <BidOrderingAuthorityRequestEditor
        sourceDecisions={[decision(), decision({ issueId: 'rules-decision', area: 'rules' })]}
        value={undefined}
        onChange={onChange}
      />,
    );

    expect(container.textContent).toContain(
      'This is an unverified request and cannot authorize Live operation.',
    );
    expect(control(container, 'Governing source decision').textContent).not.toContain(
      'rules-decision',
    );
    expect(button(container, 'Save governing comparator request').disabled).toBe(true);
    await setValue(
      control(container, 'Governing source decision'),
      'synthetic-annual-policy-decision',
    );
    await setValue(control(container, 'Primary comparator key'), 'RSC_SENIORITY');
    await setValue(control(container, 'Primary comparator direction'), 'ASC');
    await click(button(container, 'Save governing comparator request'));

    expect(onChange).toHaveBeenCalledWith({
      v: 1,
      sourceDecisionId: 'synthetic-annual-policy-decision',
      comparator: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
    });
  });
});
