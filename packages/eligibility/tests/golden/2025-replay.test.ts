import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Member, PositionRule } from '../../src/types.js';
import { type ReplayManifest, assertFixtureHashes, replayEvidence } from './replay-evidence.js';

const directory = process.env.GOLDEN_REPLAY_FIXTURE_DIR
  ? path.resolve(process.env.GOLDEN_REPLAY_FIXTURE_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const enabled = process.env.RUN_GOLDEN_REPLAY === 'true';
const files = ['2025-members.json', '2025-actual-bid.json', '2025-rules.json'];

// Explicitly requesting a replay fails when evidence is missing. An ordinary
// run records a skip, never a successful "replay opt-in" placeholder test.
describe.skipIf(!enabled)('2025 source-evidenced replay', () => {
  it('accounts for every source pick and verifies approved expectations and observed outcomes', () => {
    const raw = Object.fromEntries(
      files.map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, '2025-replay-manifest.json'), 'utf8'),
    ) as ReplayManifest;
    assertFixtureHashes(manifest, raw);
    const members = JSON.parse(raw['2025-members.json'] ?? '') as Member[];
    const rules = JSON.parse(raw['2025-rules.json'] ?? '') as PositionRule[];
    const picks = JSON.parse(raw['2025-actual-bid.json'] ?? '') as Array<{
      bidNumber: number;
      employeeId: string;
      positionId: string;
    }>;
    expect(picks.length).toBeGreaterThan(0);
    const exclusions = new Map(manifest.exclusions.map((e) => [e.bidNumber, e]));
    expect(exclusions.size).toBe(manifest.exclusions.length);
    for (const exclusion of manifest.exclusions) {
      expect(exclusion.reason.trim().length).toBeGreaterThan(0);
      expect(exclusion.sourceLocation.trim().length).toBeGreaterThan(0);
      expect(picks.some((p) => p.bidNumber === exclusion.bidNumber)).toBe(true);
    }
    for (const pick of picks) {
      if (exclusions.has(pick.bidNumber)) continue;
      expect(
        manifest.cases.some(
          (c) => c.employeeId === pick.employeeId && c.positionId === pick.positionId,
        ),
        `Unaccounted source pick ${pick.bidNumber}`,
      ).toBe(true);
    }
    const result = replayEvidence(members, rules, manifest);
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.negativeCases).toBeGreaterThan(0);
    expect(result.evaluatedOrderings).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
    console.info('Historical replay coverage', {
      sourcePicks: picks.length,
      excluded: exclusions.size,
      ...result,
    });
  });
});
