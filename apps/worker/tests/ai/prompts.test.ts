import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT_VERSION, systemBlock } from '../../src/ai/prompts/system-2026.js';
import { type RosterInput, rosterBlock } from '../../src/ai/prompts/user-roster.js';
import { type TurnInput, turnBlock } from '../../src/ai/prompts/user-turn.js';

describe('systemBlock', () => {
  it('returns an array of one text block with cache_control', () => {
    const b = systemBlock();
    expect(Array.isArray(b)).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
  });

  it('text includes all three rulebook section markers', () => {
    const b = systemBlock();
    expect(b[0]?.text).toContain('BEGIN Bid Process');
    expect(b[0]?.text).toContain('BEGIN Rules & Points');
    expect(b[0]?.text).toContain('BEGIN Position Template');
  });

  it('text states the deterministic-engine constraint verbatim', () => {
    expect(systemBlock()[0]?.text).toContain('do not recompute eligibility');
  });

  it('text declares the required JSON output shape', () => {
    expect(systemBlock()[0]?.text).toContain('"eligible_recommendations"');
    expect(systemBlock()[0]?.text).toContain('"force_recommended"');
  });

  it('SYSTEM_PROMPT_VERSION is a date-like string', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('rosterBlock', () => {
  const input: RosterInput = {
    bidSessionId: '01HF3SESSION',
    members: [
      {
        employeeId: '14335',
        firstName: 'Jesus',
        lastName: 'Sola',
        rank: 'DC',
        bidCategory: 'OFC',
        rscSeniority: 4,
        rankSeniority: 1,
        isProbationary: false,
        credentials: ['Hazardous Materials Operations', 'Rope Rescue Operations'],
        priorYearBid: 'A101',
      },
    ],
    eligibilityMatrix: [
      {
        memberEmployeeId: '14335',
        positionId: 'A101',
        eligible: true,
        points: 1,
        soPoints: 0,
        moPoints: 0,
        reasons: ['RANK_OK'],
      },
    ],
  };

  it('returns array with one user-role text block carrying cache_control', () => {
    const b = rosterBlock(input);
    expect(b).toHaveLength(1);
    expect(b[0]?.type).toBe('text');
    expect(b[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('text includes the session id', () => {
    expect(rosterBlock(input)[0]?.text).toContain('01HF3SESSION');
  });

  it('roster includes member id + rank + creds', () => {
    const t = rosterBlock(input)[0]?.text ?? '';
    expect(t).toContain('14335');
    expect(t).toContain('Hazardous Materials Operations');
  });

  it('eligibility matrix row is rendered as compact JSON line per row', () => {
    const t = rosterBlock(input)[0]?.text ?? '';
    expect(t).toMatch(/"position_id":\s*"A101"/);
  });

  it('output is deterministic — same input twice yields byte-identical text', () => {
    const a = rosterBlock(input)[0]?.text;
    const b = rosterBlock(input)[0]?.text;
    expect(a).toBe(b);
  });
});

describe('turnBlock', () => {
  const t: TurnInput = {
    phase: 'position_bid',
    currentBidderEmployeeId: '14335',
    queue: ['14335', '12345', '99999'],
    positionFills: { A101: '11111' },
    remainingPositionIds: ['A102', 'A103', 'A104'],
    question: 'Advise on the upcoming pick.',
  };

  it('returns single text block WITHOUT cache_control', () => {
    const b = turnBlock(t);
    expect(b).toHaveLength(1);
    expect(b[0]?.type).toBe('text');
    expect((b[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
  });

  it('embeds the question verbatim', () => {
    expect(turnBlock(t)[0]?.text).toContain('Advise on the upcoming pick.');
  });

  it('embeds current bidder + queue + fills', () => {
    const x = turnBlock(t)[0]?.text ?? '';
    expect(x).toContain('"current_bidder":"14335"');
    expect(x).toContain('"queue":["14335"');
  });
});
