import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';

const mocks = vi.hoisted(() => ({
  control: vi.fn(),
  version: vi.fn(),
}));

vi.mock('../../src/lib/bid-definition-source.js', () => ({
  captureBidDefinitionControl: mocks.control,
}));
vi.mock('../../src/lib/bid-definition-version.js', () => ({
  loadBidDefinitionVersion: mocks.version,
}));

const SHA = 'a'.repeat(64);
const input = {
  year: 2026,
  versionId: 'synthetic-incomplete-2026',
  versionSha256: SHA,
  bidSessionId: 'synthetic-preview',
  capturedAtMs: 1,
  mode: 'mock' as const,
};

describe('managed 2026 run inventory gate', () => {
  beforeEach(() => {
    mocks.control.mockReset().mockResolvedValue({ token: 'synthetic-control' });
    mocks.version.mockReset().mockResolvedValue({
      ok: true,
      sha256: SHA,
      row: { position_template_version: '2026.final.1' },
      content: {
        positions: [
          ...['A', 'B', 'C'].flatMap((shift) => [
            ...Array.from({ length: 72 }, (_, i) => ({
              id: `${shift}${String(i + 1).padStart(3, '0')}`,
              shift,
              rankRequired: 'FF',
              isExcludedFromCount: false,
            })),
            { id: `${shift}211`, shift, rankRequired: 'DC', isExcludedFromCount: false },
          ]),
          { id: 'A801', shift: 'A', rankRequired: 'CPT', isExcludedFromCount: true },
        ],
        participation: [],
      },
    });
  });

  it('rejects 73-per-shift arithmetic that counts the Division Chiefs before making a Mock', async () => {
    const result = await prepareBidDefinitionRun({} as D1Database, input);
    expect(result).toMatchObject({
      ok: false,
      code: '2026_shift_opportunity_inventory_invalid',
      inventoryIssues: ['division_chief_biddable:A211,B211,C211'],
    });
  });

  it('rejects 72-per-shift inventory after the Chiefs are marked non-biddable', async () => {
    const version = await mocks.version();
    version.content.participation = ['A', 'B', 'C'].map((shift) => ({
      positionId: `${shift}211`,
      bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
    }));
    mocks.version.mockResolvedValue(version);
    const result = await prepareBidDefinitionRun({} as D1Database, input);
    expect(result).toMatchObject({
      ok: false,
      code: '2026_shift_opportunity_inventory_invalid',
      inventoryIssues: [
        'A_shift_count:72:expected_73',
        'B_shift_count:72:expected_73',
        'C_shift_count:72:expected_73',
      ],
    });
  });
});
