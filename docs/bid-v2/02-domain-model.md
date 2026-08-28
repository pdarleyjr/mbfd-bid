# MBFD Bid v2 domain model

## Canonical separation

| Concept | Meaning | Must not be inferred from |
| --- | --- | --- |
| Authorized staffing slot | A funded/authorized operational placement with topology and capacity semantics. | A single current staffing export. |
| Current assignment | A person's effective-dated operational placement. | A bid award alone. |
| Bid opportunity | A selectable annual-Bid item: specific position, station pool, float pool, Days specialty, or overlay. | A staffing slot or current occupant. |

## Target aggregates (not a statement of current persistence)

- **Policy version:** source hashes, version, approval state, validated rule definitions, and immutable published snapshots. The current schema has version/status/revision metadata only; immutable policy snapshot persistence remains a release blocker.
- **Bid year/session:** phase, mock/live isolation, canonical event sequence, active/deferred turn state, frozen inputs, and audit references. Freeze-input capture and canonical audit sequencing are not implemented for live use.
- **Member eligibility snapshot:** rank, seniority inputs, credentials, specialty score inputs, provenance, and evaluation date.
- **Opportunity:** type, topology, capacity/seat semantics, eligibility requirements, constraints, and lifecycle status.
- **Award and transition:** selected opportunity, reasoning, audit command, current/effective future assignment, publication state, and reconciliation result.

## Data rules

- Additive, idempotent migrations only; no core rename/drop or destructive backfill in the v2 transition.
- Store flexible policy internals as validated, versioned data, but never expose raw JSON as an administrator workflow.
- Persist raw source artifacts only in private storage; use synthesized fixtures in the repository and tests.
- Preserve unresolved policy values as blockers/configuration gaps rather than encoding assumptions.

## Existing implementation anchors

- Shared import schemas: `packages/shared/src/schemas/`.
- Eligibility primitives: `packages/eligibility/`.
- A-Day primitives: `packages/a-day/`.
- Worker session/route/migration implementation: `apps/worker/`.

These anchors are implementation evidence, not approval of the currently seeded rule values.

## Additive source-only foundation (migrations 0021 and 0024; not deployed)

The V2 branch defines the following separation without replacing the legacy
`positions`/`position_rules` model:

- `staffing_positions` — the MBFD-owned authorized operational slot. Its
  unique `stable_slot_key` and topology/effective dates are independent of a
  TeleStaff export, current occupant, source version, or source A/R Day. A
  slot key is immutable and represents one explicit authorized seat; a pool or
  multi-seat opportunity must be modeled explicitly rather than inferred from
  concurrent source occupancy.
- `staffing_position_source_mappings` — an effective-dated, source-backed
  description of a canonical slot. A mapping uses the complete normalized
  locator/signature plus source version/hash; digests are text-only lowercase
  hexadecimal SHA-256-style values and effective dates are canonical ISO
  calendar dates.
  Short global aliases are not a valid identity mechanism. A normalized source
  system/locator has exactly one effective mapping at a time, even if its
  signature changes.
- `assignment_imports` and `assignment_import_rows` — staged source evidence,
  including source A/R Day, normalized topology, a keyed opaque
  member-reference HMAC, resolved internal member/mapping references, complete
  reconciliation disposition, and reviewer evidence where required. The
  forward-only `reconciliation_revision` supports later optimistic review
  concurrency. Non-null fingerprints and HMACs are text-only lowercase
  hexadecimal values; source versions reject common surrounding whitespace. The
  import manifest (identity, source system/version/hash, declared count, and
  creation time) is immutable at creation. An import must traverse
  `staged → reviewed → approved → committed` (or terminate as `rejected`);
  approval is refused until the reconciled row set and count are complete.
- `assignment_import_missing_observations` — negative evidence that an existing
  authoritative assignment was absent from a source export. It is intentionally
  separate from source rows, so it cannot manufacture a row or alter the
  declared input-row count. A reviewer must resolve it with either
  `RETAIN_ASSIGNMENT` or `END_ASSIGNMENT`; neither action deletes or retires a
  canonical staffing position. The finding is immutable after resolution or
  import finalization.
- `assignment_observations` — immutable evidence that a particular imported
  row observed a resolved member in a canonical slot at a point in time. An
  observation can only be inserted after its import is committed and must
  match that row's import, resolved member, source mapping, canonical slot,
  source A/R Day, and normalized topology. It cannot be updated, deleted, or
  conflict-replaced.
- `member_assignments` — MBFD Bid's authoritative effective-dated assignment
  model. It records a generic `origin_type`/`origin_ref` and lifecycle status,
  so a future `BID_AWARD` can exist before it appears in TeleStaff. Only a
  `TELESTAFF_IMPORT` assignment must carry a matching immutable
  `source_observation_id`; non-source origins must not pretend to be source
  observations. A TeleStaff materialization is append-only for its identity,
  provenance, member, slot, observation, and effective start: it may be ended
  or superseded, but never deleted, retyped, or conflict-replaced. A correction
  must be a separate `CORRECTION` record. Assignments require an approved or
  historically retired slot within that slot's active range.

Source A/R Day remains source-assignment data on staged rows and immutable
observations. It is not a canonical slot property and is not treated as the
Bid's G1/G2/G3/G4 A-Day award. An authoritative mapping between those concepts
is still a policy blocker.

The original lowercase disposition contract remains intact for historical rows.
New, explicitly classified imports use the operator taxonomy `UNCHANGED`,
`MOVED`, `NEW_ASSIGNMENT`, `NEW_POSITION`, `MISSING_OBSERVATION`,
`UNKNOWN_EMPLOYEE`, and `AMBIGUOUS_MAPPING`. The nullable v2 fields are never
backfilled: a historical `new_combination` is not silently declared to be one
of the two new meanings. Unknown employees and ambiguous mappings are hard
approval/commit blockers even after a reviewer rejects the source row. Moved
and new-assignment evidence only materializes as an observation after an
approved `APPLY_OBSERVATION`; a new position can only be deferred or rejected,
never used to auto-create staffing capacity. The database also rejects approval
or commit unless the declared source-row count matches the staged rows, and
freezes human-reviewed rows/mappings and all approved, committed, or rejected
import evidence. The same guards reject SQLite conflict-replacement writes that
would otherwise bypass delete triggers. A rejected source row is still
evidence, not an automatic vacancy or authorized-slot deletion.

Import rows hold no raw employee identifier or unsalted identity hash. The
current foundation deliberately has no parser, reviewer route, approval
workflow, transactional assignment-commit service, vacancy inference, or
bid-opportunity creation. In particular, source-version/hash compatibility and
the source-effective-date rule for selecting an effective mapping are not yet
authorized; importer implementation remains blocked pending those policy
decisions and an approved sanitized baseline.
