import { performance } from 'node:perf_hooks';

import {
  type BidAdvisoryComposerInput,
  composeBidAdvisoryBundle,
} from '../src/lib/bid-advisory-composer.js';

function input(sequence: number, isMock: boolean): BidAdvisoryComposerInput {
  return {
    session: {
      id: isMock ? 'benchmark-mock' : 'benchmark-live',
      sequence,
      phase: 'position_bid',
      isMock,
      frozen: true,
      ruleBookVersion: 'benchmark-rules',
      positionTemplateVersion: 'benchmark-positions',
      configurationRevision: 1,
      acceptedStaffingBaseline: !isMock,
    },
    ordering: {
      currentBidder: { memberId: sequence + 1, displayName: 'Benchmark Member', ordinal: 1 },
      onDeckCount: 2,
      remainingCount: 100,
    },
    positions: {
      biddableCount: 264,
      filledCount: sequence % 200,
      unfilledCount: 264 - (sequence % 200),
      currentBidderEligibility: {
        memberId: sequence + 1,
        eligibleUnfilledCount: 50,
        ineligibleUnfilledCount: 14,
        blockingReasonLabels: ['RANK_REQUIRED', 'SPECIALTY_CREDENTIAL_REQUIRED'],
      },
    },
    specialty: null,
    aDay: null,
    annual: {
      unresolvedCount: 2,
      returnedAtCurrentSequenceCount: 0,
      finalizationReady: false,
    },
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error('at least one timing sample is required');
  return sorted.at(Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)) ?? 0;
}

function metrics(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

function measure(count: number, isMock: boolean): { samples: number[]; total: number } {
  const samples: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const sampleStarted = performance.now();
    composeBidAdvisoryBundle(input(index, isMock));
    samples.push(performance.now() - sampleStarted);
  }
  return { samples, total: performance.now() - started };
}

for (let index = 0; index < 1_000; index += 1) composeBidAdvisoryBundle(input(index, false));

const ordinary = measure(10_000, false);
const mock = measure(200, true);
const ordinaryMetrics = metrics(ordinary.samples);
const mockMetrics = metrics(mock.samples);

process.stdout.write(
  `${JSON.stringify({
    unit: 'milliseconds',
    ordinary: { count: ordinary.samples.length, ...ordinaryMetrics },
    mockSequence: { count: mock.samples.length, total: mock.total, ...mockMetrics },
  })}\n`,
);
