# Department staffing read model

`GET /api/admin/department/current-roster` requires the existing administrator authority. It accepts a calendar `as_of` date and optional shift, station, division, unit and rank filters. It does not mutate personnel, policy, audit, version or run state.

`loadDepartmentRosterProjection` is the single occupancy source for Department and the legacy `current-roster` adapter. Approved positions are effective from `active_from` through `active_to`, inclusive. A planned/active assignment, or ended/superseded assignment with an explicit end, is visible through its inclusive effective end. Cancelled assignments and unapproved positions do not appear as current capacity.

Personnel rank and employment status use the existing `derivePersonnelMemberAsOf` evaluator. Its first recorded before-state prevents later mutable member values leaking backward before the first lifecycle event. This fixes a historical fallback defect while preserving the established current-roster fixtures.

Organization identity and dated parent/name versions come from the existing catalog. Only explicit staffing links change location labels; names are never used to guess a link. Unlinked and explicitly unlinked slots retain their recorded labels. A linked apparatus moving to a group loses its former station label. Missing, retired or cyclic linked hierarchy fails visibly. Empty and retired catalog units remain available as organization context. Filters run after hierarchy resolution, so renamed station/unit filters work for the requested date.

`updatedAt` is the newest **recorded** source timestamp in milliseconds. Existing member writers use both epoch seconds and milliseconds; the projection normalizes each member timestamp before choosing the maximum. It never substitutes request time for modification evidence. Legacy temporary assignment endings lack an end-modification timestamp; their actual end date is still respected, but the historical edit time cannot be reconstructed. Today separately labels the time its latest request succeeded as **Refreshed**.

The legacy `GET /api/admin/current-roster` and CSV remain available. Their adapter adds the explicitly designated annual rule book's administrative participation metadata and member Bid category. Department itself never queries annual rule books or Bid opportunities. Legacy endpoint retirement requires migration of Bid board/history/print/export consumers with parity evidence; it is not part of the first slice.

No schema migration is needed for this read model. The existing personnel, qualification, organization and import write services remain authoritative. Today refreshes periodically, on focus and on request; the shared personnel-refresh hook invalidates its Department query after successful changes.

## Validation evidence

- Dedicated tests prove authenticated reads, invalid input rejection, no annual-policy query, no database mutation, current legacy parity, custom shifts, date boundaries, first-event history, organization rename/reparent and resolved filters.
- Mixed timestamp regressions first failed and then passed for member-only seconds, seconds newer than older staffing milliseconds, existing millisecond writers and mixed rows.
- Existing current-roster golden assertions remain in the test gate.
- `unified-bid-characterization.test.ts` characterizes current executable stage, eligibility and scoring behavior. This is not an approved normative 2026 or private historical replay manifest.

Release validation and production/browser acceptance are recorded separately for each exact candidate. A passing focused test is not a release claim.
