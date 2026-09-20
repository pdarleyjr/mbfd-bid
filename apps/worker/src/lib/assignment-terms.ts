import type { FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { type TenureEvidence, isProtectedTenure } from './tenure-evidence.js';

/** Service completion permits the incumbent to leave; consecutive bid cycles
 * determine annual reopening. They are distinct source facts, never dates
 * fabricated from seniority or an assumed annual session schedule. */
export function evaluateAssignmentTerms(input: {
  asOf: string;
  terms: NonNullable<FrozenAnnualOperationsPolicy['assignmentTerms']>;
  records: readonly TenureEvidence[];
  bindings: readonly { positionId: string; staffingPositionId: string; reviewStatus: string }[];
  assignments: readonly { staffingPositionId: string; memberId: number }[];
  nonBiddablePositionIds: readonly string[];
}) {
  return input.terms.flatMap((term) =>
    term.positionIds.map((positionId) => {
      const binding = input.bindings.find(
        (row) => row.positionId === positionId && row.reviewStatus === 'approved',
      );
      const base = {
        positionId,
        termId: term.id,
        sourceRef: term.sourceRef,
        requiredServiceMonths: term.requiredServiceMonths,
        reopenAfterConsecutiveCycles: term.reopenAfterConsecutiveCycles,
      };
      if (!binding)
        return {
          ...base,
          status: 'BLOCKED' as const,
          code: 'term_binding_required',
          memberMayLeave: null,
          offerAnnually: null,
          protected: null,
        };
      const holders = input.assignments.filter(
        (row) => row.staffingPositionId === binding.staffingPositionId,
      );
      const record = input.records.find(
        (row) => row.staffingPositionId === binding.staffingPositionId,
      );
      const blocked = (code: string) => ({
        ...base,
        status: 'BLOCKED' as const,
        code,
        memberMayLeave: null,
        offerAnnually: null,
        protected: null,
      });
      if (holders.length > 1) return blocked('term_holder_ambiguous');
      const closed = input.nonBiddablePositionIds.includes(positionId);
      if (term.closedForThisBid)
        return {
          ...base,
          status: closed ? ('EVALUATED' as const) : ('BLOCKED' as const),
          code: closed ? 'term_closed_by_annual_policy' : 'term_annual_closure_required',
          memberMayLeave: null,
          offerAnnually: false,
          protected: null,
        };
      if (!record || record.status === 'UNKNOWN') return blocked('term_evidence_required');
      const holder = holders[0];
      if (!holder)
        return {
          ...base,
          status: 'EVALUATED' as const,
          code: 'term_vacant',
          memberMayLeave: null,
          offerAnnually: true,
          protected: false,
        };
      if (
        record.termMemberId !== holder.memberId ||
        record.accumulatedServiceMonths == null ||
        record.consecutiveBidCycles == null
      )
        return blocked('term_holder_service_evidence_required');
      const memberMayLeave = record.accumulatedServiceMonths >= term.requiredServiceMonths;
      const offerAnnually = record.consecutiveBidCycles >= term.reopenAfterConsecutiveCycles;
      // Evidence claiming completed cycles with an unfinished service term is
      // contradictory; an administrator must reconcile the source facts.
      if (offerAnnually && !memberMayLeave) return blocked('term_service_cycle_conflict');
      // Prior service can permit voluntary departure before the current protected
      // appointment expires. It does not authorize another member to bump them.
      const protectedTerm = !memberMayLeave || isProtectedTenure(record, input.asOf);
      if (offerAnnually && protectedTerm) return blocked('term_service_cycle_conflict');
      const code =
        protectedTerm && !closed
          ? 'protected_term_cannot_be_biddable'
          : offerAnnually && closed
            ? 'completed_cycles_require_annual_reopening'
            : protectedTerm
              ? 'term_in_progress'
              : offerAnnually
                ? 'term_annually_open'
                : 'term_service_complete';
      return {
        ...base,
        status:
          (protectedTerm && !closed) || (offerAnnually && closed)
            ? ('BLOCKED' as const)
            : ('EVALUATED' as const),
        code,
        memberMayLeave,
        offerAnnually,
        protected: protectedTerm,
      };
    }),
  );
}
