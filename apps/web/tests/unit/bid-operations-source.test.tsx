import type { BidDefinitionContent } from '@mbfd/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BidOperations } from '../../app/admin/current-bid/BidOperations';

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { mock: null } }) }));
vi.mock('../../app/admin/targetsolutions/LatestCredentialSource', () => ({
  LatestCredentialSource: () => null,
}));

function render(status?: 'OPEN' | 'RESOLVED') {
  const decisions: BidDefinitionContent['sourceDecisions'] = [
    {
      issueId: '2026-latest-substantive-ranks',
      title: 'Latest source ranks',
      question: 'Which source governs?',
      area: 'annual-policy',
      status: 'RESOLVED',
      sourceRef: 'Reviewed MASTER V3',
    },
  ];
  if (status)
    decisions.push({
      issueId: '2026-master-v4-supersession',
      title: 'MASTER V4 supersedes V3',
      question: 'Has V4 been accepted?',
      area: 'annual-policy',
      status,
      sourceRef: 'Reviewed MASTER V4',
    });
  return renderToStaticMarkup(
    <BidOperations
      year={2026}
      content={{
        v: 1,
        bidYear: 2026,
        settings: null,
        notes: { bid: null, positions: null },
        policy: null,
        planning: null,
        authoring: null,
        positions: [],
        rules: [],
        participation: [],
        staffingBindings: [],
        sourceDecisions: decisions,
      }}
      versionId="saved-source-version"
      disabled={false}
      ready
      onCheckMock={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
}

describe('saved MASTER source identity', () => {
  it('shows accepted V4 instead of the superseded V3 label', () => {
    expect(render('RESOLVED')).toContain('MASTER V4');
    expect(render('RESOLVED')).not.toContain('MASTER V3');
  });

  it.each([undefined, 'OPEN'] as const)('retains V3 until V4 is accepted: %s', (status) => {
    expect(render(status)).toContain('MASTER V3');
    expect(render(status)).not.toContain('MASTER V4');
  });
});
