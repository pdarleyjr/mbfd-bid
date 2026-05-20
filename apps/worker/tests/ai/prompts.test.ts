import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT_VERSION, systemPrompt } from '../../src/ai/prompts/system-2026.js';
import { type RosterInput, rosterPrompt } from '../../src/ai/prompts/user-roster.js';
import { type TurnInput, turnPrompt, userPrompt } from '../../src/ai/prompts/user-turn.js';

describe('systemPrompt', () => {
  it('returns a plain string (no cache_control after Workers AI swap)', () => {
    const s = systemPrompt();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(100);
  });

  it('text includes all three rulebook section markers', () => {
    const s = systemPrompt();
    expect(s).toContain('BEGIN Bid Process');
    expect(s).toContain('BEGIN Rules & Points');
    expect(s).toContain('BEGIN Position Template');
  });

  it('text states the deterministic-engine constraint verbatim', () => {
    expect(systemPrompt()).toContain('do not recompute eligibility');
  });

  it('text declares the required JSON output shape', () => {
    expect(systemPrompt()).toContain('"eligible_recommendations"');
    expect(systemPrompt()).toContain('"force_recommended"');
  });

  it('SYSTEM_PROMPT_VERSION is a date-like string', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('rosterPrompt', () => {
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

  it('returns a plain string', () => {
    const s = rosterPrompt(input);
    expect(typeof s).toBe('string');
  });

  it('text includes the session id', () => {
    expect(rosterPrompt(input)).toContain('01HF3SESSION');
  });

  it('roster includes member id + rank + creds', () => {
    const t = rosterPrompt(input);
    expect(t).toContain('14335');
    expect(t).toContain('Hazardous Materials Operations');
  });

  it('eligibility matrix row is rendered as compact JSON line per row', () => {
    const t = rosterPrompt(input);
    expect(t).toMatch(/"position_id":\s*"A101"/);
  });

  it('output is deterministic — same input twice yields byte-identical text', () => {
    const a = rosterPrompt(input);
    const b = rosterPrompt(input);
    expect(a).toBe(b);
  });
});

describe('turnPrompt + userPrompt', () => {
  const t: TurnInput = {
    phase: 'position_bid',
    currentBidderEmployeeId: '14335',
    queue: ['14335', '12345', '99999'],
    positionFills: { A101: '11111' },
    remainingPositionIds: ['A102', 'A103', 'A104'],
    question: 'Advise on the upcoming pick.',
  };

  it('turnPrompt returns a plain string', () => {
    expect(typeof turnPrompt(t)).toBe('string');
  });

  it('turnPrompt embeds the question verbatim', () => {
    expect(turnPrompt(t)).toContain('Advise on the upcoming pick.');
  });

  it('turnPrompt embeds current bidder + queue + fills', () => {
    const x = turnPrompt(t);
    expect(x).toContain('"current_bidder":"14335"');
    expect(x).toContain('"queue":["14335"');
  });

  it('userPrompt concatenates roster + turn text', () => {
    const u = userPrompt({ roster: 'ROSTER_HERE', turn: turnPrompt(t) });
    expect(u).toContain('ROSTER_HERE');
    expect(u).toContain('Advise on the upcoming pick.');
  });
});
