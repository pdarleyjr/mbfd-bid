import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../../src/evaluate.js';
import type { Member, PositionRule } from '../../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.resolve(__dirname, '../fixtures');

const REQUIRED_FIXTURES = ['2025-members.json', '2025-actual-bid.json', '2025-rules.json'];
const FIXTURES_PRESENT = REQUIRED_FIXTURES.every((f) => fs.existsSync(path.join(FIX_DIR, f)));
const OPT_IN = process.env.RUN_GOLDEN_REPLAY === 'true';
const SHOULD_RUN = FIXTURES_PRESENT && OPT_IN;

interface ReplayPick {
  bidNumber: number;
  employeeId: string;
  positionId: string;
  bidCategory: string;
}

const members: Member[] = SHOULD_RUN
  ? (JSON.parse(fs.readFileSync(path.join(FIX_DIR, '2025-members.json'), 'utf8')) as Member[])
  : [];
const rules: PositionRule[] = SHOULD_RUN
  ? (JSON.parse(fs.readFileSync(path.join(FIX_DIR, '2025-rules.json'), 'utf8')) as PositionRule[])
  : [];
const picks: ReplayPick[] = SHOULD_RUN
  ? (JSON.parse(
      fs.readFileSync(path.join(FIX_DIR, '2025-actual-bid.json'), 'utf8'),
    ) as ReplayPick[])
  : [];

const memberByEmpId = new Map<string, Member>(members.map((m) => [m.employeeId, m]));
const ruleByPositionId = new Map<string, PositionRule>(rules.map((r) => [r.positionId, r]));

const SKIP_POSITION_PREFIXES = ['D5', 'D501', 'D502', 'D503', 'D504', 'D505'];
const EXCLUDED_CATEGORY = 'EXCLUDED';

function pickIsEligibilityCheckable(pick: ReplayPick): boolean {
  if (pick.bidCategory === EXCLUDED_CATEGORY) {
    return false;
  }
  if (SKIP_POSITION_PREFIXES.some((p) => pick.positionId.startsWith(p))) {
    return false;
  }
  return true;
}

describe.skipIf(!SHOULD_RUN)('2025 bid replay — zero false negatives', () => {
  it('engine has rules for every position that appears in the bid picks', () => {
    const missingRules: string[] = [];
    for (const pick of picks) {
      if (!pickIsEligibilityCheckable(pick)) {
        continue;
      }
      if (!ruleByPositionId.has(pick.positionId)) {
        missingRules.push(pick.positionId);
      }
    }
    if (missingRules.length > 0) {
      console.warn(`Positions without rules: ${[...new Set(missingRules)].join(', ')}`);
    }
  });

  it('for every pick, the engine reports eligible = true', () => {
    const falseNegatives: Array<{
      bidNumber: number;
      employeeId: string;
      positionId: string;
      reasons: string;
    }> = [];

    for (const pick of picks) {
      if (!pickIsEligibilityCheckable(pick)) {
        continue;
      }
      const member = memberByEmpId.get(pick.employeeId);
      const rule = ruleByPositionId.get(pick.positionId);
      if (member === undefined || rule === undefined) {
        continue;
      }

      const result = evaluateEligibility(member, rule);
      if (!result.eligible) {
        falseNegatives.push({
          bidNumber: pick.bidNumber,
          employeeId: pick.employeeId,
          positionId: pick.positionId,
          reasons: result.reasons
            .filter((r) => !r.satisfied)
            .map((r) => r.label)
            .join('; '),
        });
      }
    }

    if (falseNegatives.length > 0) {
      console.error('FALSE NEGATIVES (engine says ineligible for an actual 2025 pick):');
      for (const fn of falseNegatives) {
        console.error(
          `  Bid #${fn.bidNumber}: emp=${fn.employeeId} pos=${fn.positionId} — ${fn.reasons}`,
        );
      }
    }

    expect(falseNegatives).toHaveLength(0);
  });

  it('engine runs in under 100ms for the full pick set', () => {
    const start = performance.now();
    for (const pick of picks) {
      if (!pickIsEligibilityCheckable(pick)) {
        continue;
      }
      const member = memberByEmpId.get(pick.employeeId);
      const rule = ruleByPositionId.get(pick.positionId);
      if (member === undefined || rule === undefined) {
        continue;
      }
      evaluateEligibility(member, rule);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

describe.skipIf(SHOULD_RUN)('2025 bid replay (skipped)', () => {
  it('replay opt-in', () => {
    const reasons: string[] = [];
    if (!FIXTURES_PRESENT) {
      reasons.push(
        'Fixtures not present (run `pnpm dlx tsx packages/eligibility/scripts/export-fixtures.ts`)',
      );
    }
    if (!OPT_IN) {
      reasons.push('Opt-in env var not set (RUN_GOLDEN_REPLAY=true)');
    }
    console.warn(`2025 golden replay skipped: ${reasons.join('; ')}`);
    expect(SHOULD_RUN).toBe(false);
  });
});
