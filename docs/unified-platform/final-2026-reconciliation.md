# Final 2026 reconciliation and release evidence

This is an implementation work record, not a production-readiness assertion.

## Verified starting identities

| Identity | SHA | Tree |
| --- | --- | --- |
| Main | ec4087a2166cffdfa8f4c96cb66d0db5ddc8ca0c | ef056f6f38e8a27324d37a562402a2a914a6ba45 |
| Candidate, PR 129 | e584f91687d09e0e63edff1088a0dddc345d13fc | ecbbae3e9090d4b61f5b31016c05e0ae03249fae |

On 2026-09-19 PR 129 remained open, draft and mergeable. Its hosted lint/typecheck,
unit/integration and CodeQL checks passed; Playwright was skipped. Those checks do
not validate subsequent work. Existing uncommitted profile code was preserved in
an ignored diagnostic archive before editing. The older shared checkout was left intact.

## Source findings

All four final-source hashes match the supplied identities. The nine-page PDF
is marked July 2026. Master Positions contains 228 distinct enabled organization
slots: A 74, B 73, C 73 and D 8. Organizational enablement does not establish Bid
availability: the PDF closes Training, Support Services and Rescue Days terms.

A read-only production comparison found 242 rows in the designated 2026
template, versus 228 final master rows. Only 177 source identifiers are shared;
51 are absent. Among shared identifiers, 67 units and 29 normalized rank
categories differ. For example, production A102 is a Firefighter DE on Ladder 1,
while final master A102 is a Lieutenant in Combat 1. Identical source numbers
therefore do not establish staffing identity. A new final-source version must
retain reviewed crosswalk evidence and cannot inherit old staffing bindings by ID.

PDF page 8, Bid Selection 4 and footnote 4, establishes Captain, Lieutenant,
Firefighter stage order and distinct seniority domains: time in grade for other
ranks, Department seniority for firefighters. Reverse ordering uses the same
domain. The master RscSeniorityIn values do not match the calculation workbook's
Rank Seniority and Straight Seniority channels; no automatic field alias is valid.
Promotion dates are absent from the joined master population. Final data mapping
requires explicit provenance and must not manufacture dates or break unresolved ties.

PDF pages 7-8 require Station 1/3 combat FF/DE station opportunities (with the
Investigator exception), pool floats, SWAT overlay membership, and defer/return
without an invented contact-attempt count. These semantics require execution and
Department-transition validation beyond displaying new labels.

The calculation workbook contains eligibility/point formula defects, including
optional Marine points compensating for missing minimums, an Air Tech OR where
both certificates are required, incomplete Captain 5 service/Paramedic checks,
and missing Investigator minimum/preference logic. The PDF governs corrections.
Cached workbook errors were observed; no Excel recalculation was claimed.

## User clarification

On 2026-09-19 the user resolved the Marine fallback ambiguity: **Only
minimum-qualified personnel may be forced.** This is user clarification, distinct
from the PDF's cross-reference to section 2. A force grant alone cannot bypass
minimum eligibility.

## Implementation under validation

- Shared rule profiles use the existing compiler. Save compiles pending profile
  edits into concrete rules with provenance. Optional review reports affected
  positions and same-evaluator impact; it creates no version or run.
- Contextual ordering uses a version-2 authority with a comparator per stage.
  Version-1 global authorities remain readable. Missing stages or disagreement
  with the resolved source decision fail closed; member IDs never break a tie.
- Canonical Live award changes, including force, amendments and specialty
  acceptance, must pass the frozen eligibility evaluator before persistence.
- Specialty ranking receives the same frozen scoring evidence as coverage.
- Ordered fallback derives eligible candidates, comparator order and earlier-tier
  exhaustion from the frozen policy and durable responses. Required decline and
  unreachable evidence is checked before a response can advance the tier.
- Simultaneous A-Day selection uses the existing pure allocation engine with
  explicit source scopes and upper bounds on each award. Completion checks lower
  bounds. Assignment changes cannot bypass these checks.
- Reviewed term facts distinguish accumulated service from consecutive bid cycles.
  Additive migration 0063 retains historical evidence and checks integral bounds.
  Prior service does not erase an active incumbent protection period.
- Results reads canonical awards and completion evidence without accessing Durable
  Objects or merging historical legacy awards. History accepts canonical command
  action filters and orders records by creation time and identity.

Production preflight confirmed migrations through 0058, three historical Mock
sessions and no Real sessions. No remote migration, session command, personnel
mutation or deployment has been performed in this work record. Local tests and
read-only runtime observations are separate evidence classes.

The private production export was restored locally and migrations 0059–0063
applied to that local copy. All 20,662 existing rows across 75 original tables
retained identical values in every original column. SQLite quick-check passed;
foreign-key checks reported zero violations before and after. The export and
per-table evidence remain private and ignored by Git. This proves a local
rehearsal, not a remote migration or a current deployment backup guarantee.

The expanded Current Bid and historical browser suite passed 20 tests against
isolated synthetic fixtures, including desktop/mobile layouts, explicit Results
run selection, preserved membership labels, pagination and Save/Restore behavior.

Full platform integration, source-data mapping, final configuration, full tests,
browser acceptance, migration/recovery rehearsal and exact-source deployment
remain separate gates. No production or Real Bid action is established by this record.
