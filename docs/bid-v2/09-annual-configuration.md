# Annual Bid Configuration Boundary

## Purpose

One `bid_years` record is the designated source for one annual Bid. It selects
the rule book and position template, stores only supported duration/timer
settings, and advances an optimistic `configuration_revision` whenever that
designation changes. It is not a second staging-only policy store.

This is source-local design and test evidence. It has not applied migration
`0025_bid_configuration_snapshot_revision.sql`, changed a remote rule book, or
authorized a live session.

## Lifecycle

| Action | Required configuration state | Result |
| --- | --- | --- |
| Designate/update a draft | Bid year `configuring`; candidate rule book `draft`; valid coverage | Atomically selects one draft/template/settings and increments `configuration_revision`. |
| Create mock | Exact designated rule book remains `draft` | Creates a V3 immutable policy snapshot. |
| Publish/freeze a draft | Exact designated draft plus coverage and staffing preflight | Promotion is blocked unless every preflight succeeds. |
| Create live session | Exact designated rule book is `active` | Creates a V3 immutable policy snapshot; separate live-readiness controls still block a start. |

The API endpoints are `GET`/`PUT /api/admin/bid-configuration/:year`. The
`PUT` endpoint is step-up protected and does not create a bid year, rule book,
staffing baseline, or member record.

## Mock history

Fresh V3 snapshots record one self-contained deterministic input:

- rule-book version and revision;
- exact raw rule rows, rule participation, and non-PII position-template display fields;
- position-template version;
- configuration revision and supported settings;
- frozen member pool, seniority, rank, probationary state, credential names, and exclusion provenance;
- capture timestamp. The Bid order is deterministically derived from this frozen pool and persisted when the session starts.

A settings-only or rule-book change to the same draft is intentionally
forward-looking: later mocks use the new material while an established V3 mock
continues to use exactly what it captured. Its board and CSV/PDF export use
frozen rank, position metadata, and stable session pseudonyms; they never join
today's member or position records. Directory names and employee identifiers are
not copied into the snapshot. A named historical-export retention requirement
would need separate authorization.

Pointer-only V1/V2 records remain structurally inspectable as forensic legacy
records but cannot operate the Bid engine: they lack immutable rule and member
material, so all engine actions fail closed with
`session_policy_snapshot_material_missing`. The system never creates a missing
snapshot later from a mutable draft.

The only currently approved annual settings are duration and turn timer. No
annual A-Day or AI-assist setting is inferred or invented. A-Day phase state, if
created through its separately guarded lifecycle, is session state rather than a
replacement for approved annual policy.

## Publication safety

Publication validates the candidate rule-book coverage, the exact designated
configuration, and its optimistic revision at the D1 transition boundary. It
then runs the same read-only staffing/Division-Chief checks used for snapshot
construction. No route uses a globally active-book fallback.

The source guard detects committed source-backed TeleStaff staffing evidence as
a minimum technical preflight. That guard is not a claim that MBFD's real
annual staffing baseline is complete or approved. Real acceptance still
requires the authoritative baseline, reviewed A211/B211/C211 bindings, and
proof of their assigned-occupant exclusions. Test-only fixtures are synthetic
and never represent operational TeleStaff data.

## Operator surface and remaining gates

The Bid Setup page displays the selected lifecycle/revisions/settings and can
only call the designated configuration endpoint. New-session UI defaults to a
mock rehearsal; live mode is explicit and independently server-gated. Mock
boards hide generic live controls and use only the rehearsal freeze command.

No current UI or source change creates the required MBFD Hub `bid.manage`
permission bridge, imports/reconciles real TeleStaff data, starts a live Bid,
or enables Employee Portal writeback. Keep
`PORTAL_WRITEBACK_ENABLED=false` and the portal writer absent until a separate
authorized production release.
