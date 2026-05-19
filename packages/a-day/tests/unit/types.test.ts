import { describe, expectTypeOf, it } from 'vitest';
import type {
  ADayGroupId,
  ADayPick,
  ADayState,
  ADayValue,
  CapacityMeter,
  GroupCapacityConfig,
  OfficerInvariantSnapshot,
  Phase2BidOrderStrategy,
  PickValidation,
  Shift,
  Weekday,
  WeekdayCapacityConfig,
} from '../../src/types.js';

describe('a-day types (structural)', () => {
  it('ADayGroupId is one of four literals', () => {
    expectTypeOf<ADayGroupId>().toEqualTypeOf<'G1' | 'G2' | 'G3' | 'G4'>();
  });

  it('Weekday union covers all 7 days in ISO order', () => {
    expectTypeOf<Weekday>().toEqualTypeOf<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>();
  });

  it('ADayValue is the union of GroupId and Weekday', () => {
    expectTypeOf<ADayValue>().toEqualTypeOf<ADayGroupId | Weekday>();
  });

  it('Shift includes A, B, C, D', () => {
    expectTypeOf<Shift>().toEqualTypeOf<'A' | 'B' | 'C' | 'D'>();
  });

  it('GroupCapacityConfig has min, max, officersRequired', () => {
    expectTypeOf<GroupCapacityConfig>().toHaveProperty('min');
    expectTypeOf<GroupCapacityConfig>().toHaveProperty('max');
    expectTypeOf<GroupCapacityConfig>().toHaveProperty('officersRequired');
  });

  it('WeekdayCapacityConfig has max', () => {
    expectTypeOf<WeekdayCapacityConfig>().toHaveProperty('max');
  });

  it('CapacityMeter has total, max, officers, officersRequired, isFull', () => {
    expectTypeOf<CapacityMeter>().toHaveProperty('total');
    expectTypeOf<CapacityMeter>().toHaveProperty('max');
    expectTypeOf<CapacityMeter>().toHaveProperty('officers');
    expectTypeOf<CapacityMeter>().toHaveProperty('officersRequired');
    expectTypeOf<CapacityMeter>().toHaveProperty('isFull');
  });

  it('OfficerInvariantSnapshot has expected fields', () => {
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('shift');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('group');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('currentOfficers');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('projectedOfficers');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('required');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('feasible');
    expectTypeOf<OfficerInvariantSnapshot>().toHaveProperty('explanation');
  });

  it('ADayPick has memberId, shift, aDay, pickedAtMs, forced, adminActorId', () => {
    expectTypeOf<ADayPick>().toHaveProperty('memberId');
    expectTypeOf<ADayPick>().toHaveProperty('shift');
    expectTypeOf<ADayPick>().toHaveProperty('aDay');
    expectTypeOf<ADayPick>().toHaveProperty('pickedAtMs');
    expectTypeOf<ADayPick>().toHaveProperty('forced');
    expectTypeOf<ADayPick>().toHaveProperty('adminActorId');
  });

  it('ADayState has groupCaps, weekdayCaps, picksByMember, bidOrder, cursor', () => {
    expectTypeOf<ADayState>().toHaveProperty('groupCaps');
    expectTypeOf<ADayState>().toHaveProperty('weekdayCaps');
    expectTypeOf<ADayState>().toHaveProperty('picksByMember');
    expectTypeOf<ADayState>().toHaveProperty('bidOrder');
    expectTypeOf<ADayState>().toHaveProperty('cursor');
    expectTypeOf<ADayState>().toHaveProperty('phase1ByMember');
    expectTypeOf<ADayState>().toHaveProperty('membersById');
  });

  it('PickValidation discriminated union has ok or rejected variants', () => {
    type OkVariant = Extract<PickValidation, { ok: true }>;
    type RejectVariant = Extract<PickValidation, { ok: false }>;
    expectTypeOf<OkVariant>().toHaveProperty('ok');
    expectTypeOf<RejectVariant>().toHaveProperty('reasonCode');
    expectTypeOf<RejectVariant>().toHaveProperty('reasonLabel');
  });

  it('Phase2BidOrderStrategy is one of two literals', () => {
    expectTypeOf<Phase2BidOrderStrategy>().toEqualTypeOf<
      'phase_1_order' | 'by_shift_then_seniority'
    >();
  });
});
