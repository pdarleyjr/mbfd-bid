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

## Additive source-only foundation (migration 0021; not deployed)

The V2 branch now defines these separate tables without replacing the legacy
`positions`/`position_rules` model:

- `staffing_positions` — source-versioned, reviewed operational topology; its
  `a_r_day` field is source terminology and must not be interpreted as a Bid
  A-Day selection.
- `assignment_imports` and `assignment_import_rows` — staged source evidence
  and complete reconciliation dispositions. A committed import requires both
  an approving member and approval timestamp at the database boundary.
- `member_assignments` — observed, effective-dated assignment records linked
  to a source import, not bid awards or capacity.
- `assignment_aliases` and `assignment_service_history` — provenance-preserving
  reconciliation and historical context.

Import rows hold a row fingerprint and optional keyed opaque member-reference
HMAC, never a raw employee identifier or an unsalted identifier hash. The
current foundation deliberately has no parser, reviewer route, approval
workflow, assignment commit service, vacancy inference, or bid-opportunity
creation. Those require an approved sanitized baseline and independent policy
decisions.
