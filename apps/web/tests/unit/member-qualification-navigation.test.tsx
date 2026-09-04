import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterClient } from '../../app/admin/members/roster/RosterClient';

describe('qualification lifecycle discovery from member views', () => {
  it('labels member-detail credentials as references and links to the selected effective-dated lifecycle', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/admin/members/[id]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('/admin/personnel/qualifications?memberId=${member.id}');
    expect(source).toContain('Review qualification lifecycle');
    expect(source).toContain('Legacy credential references');
    expect(source).toMatch(/do not establish current\s+qualification/);
  });

  it('gives every master-roster row a selected-member lifecycle link instead of treating credential references as current qualification', () => {
    const html = renderToString(
      <RosterClient
        initialMembers={[
          {
            id: 7,
            employee_id: 'synthetic-007',
            last_name: 'Operator',
            first_name: 'Avery',
            rank: 'FF',
            bid_category: 'FF',
            rsc_seniority: 7,
            rank_seniority: 5,
            ordinal: 1,
            manual_override_ordinal: null,
            credential_ids: [13],
          },
        ]}
        credentials={[{ id: 13, name: 'Synthetic Credential', fyPointsDefault: 0 }]}
        initialSearch=""
      />,
    );

    expect(html).toContain('/admin/personnel/qualifications?memberId=7');
    expect(html).toContain('Review qualification lifecycle');
    expect(html).toContain('Legacy credential references');
    expect(html).toContain('effective-dated qualification lifecycle');
  });

  it('labels tracked civilians without presenting bid seniority or reorder controls', () => {
    const html = renderToString(
      <RosterClient
        initialMembers={[
          {
            id: 25982,
            employee_id: '25982',
            last_name: 'De Young',
            first_name: 'Gerald',
            rank: 'CIVILIAN',
            bid_category: 'EXCLUDED',
            rsc_seniority: null,
            rank_seniority: null,
            ordinal: 4,
            manual_override_ordinal: null,
            credential_ids: [],
          },
        ]}
        credentials={[]}
        initialSearch=""
        bidOrderSession={{ sessionId: 'synthetic-session', label: 'Synthetic' }}
      />,
    );

    expect(html).toContain('Civilian');
    expect(html).toContain('Not applicable');
    expect(html).toContain('aria-label="Move De Young up" disabled=""');
    expect(html).toContain('aria-label="Move De Young down" disabled=""');
  });
});
