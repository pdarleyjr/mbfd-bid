# Annual Bid Configuration Boundary

## Purpose

One `bid_years` record is the designated source for one annual Bid. It selects
the rule book and position template, stores supported duration/timer settings
and an explicit credential-evaluation date in current V2 settings, and advances
an optimistic `configuration_revision` whenever that designation changes. It is
not a second staging-only policy store.

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
- frozen member pool, seniority, rank, probationary state, credential names,
  source-safe specialty lifecycle status facts, and exclusion provenance;
- the V2 configured credential-evaluation date when V2 settings are used;
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

Current V2 settings require `credentialEvaluationOn` in addition to duration
and turn timer. Credential and specialty evidence are evaluated as of that
explicit configuration date, while staffing/personnel remain captured at session
creation. Existing V1 settings remain readable for recovery/inspection, but
cannot create a new mock or live session because they cannot prove the required
credential-evaluation date; the server returns
`bid_configuration_credential_evaluation_date_required`. Fresh V3 snapshots
retain only specialty code, status, effective date, and expiration date—never
the source reference, actor, or reason. A pre-bridge V3 snapshot without those
facts remains readable, but a new specialty test requiring a specialty code
fails closed rather than treating absence as qualification.

No annual A-Day or AI-assist setting is inferred or invented. A-Day phase state,
if created through its separately guarded lifecycle, is session state rather
than a replacement for approved annual policy.

## Publication safety

Publication validates the candidate rule-book coverage, the exact designated
configuration, and its optimistic revision at the D1 transition boundary. It
then runs the same read-only staffing/Division-Chief checks used for snapshot
construction. No route uses a globally active-book fallback.

The staffing guard requires an explicit, immutable accepted TeleStaff manifest
for the exact Bid year; it never selects an arbitrary historic import. Its
structured preflight rechecks the versioned source format/parser, source hash,
data-row and opaque-identity manifest accounting, duplicate prevention,
reviewed incomplete-topology evidence, unresolved mappings, observations, and
canonical assignment lineage. It has no static 262-row assumption. Raw HTML,
names, Emp IDs, HMACs, fingerprints, and source topology values do not appear
in the publication response.

The local-only HTML adapter recognizes one semantic `(EX) Export Assignments`
table and treats structural blank/NBSP/hidden-placeholder cells as null source
evidence. It does not infer effective dates, canonical slots, capacity, or
portal work. The read-only admin inspection surface exposes only aggregate
format/accounting validation; it still has no upload, apply, or external
TeleStaff path. No local fixture is an accepted MBFD annual baseline.

Import scope is immutable. Only an `official` TeleStaff source manifest may be
designated as an annual baseline. A `synthetic_test` manifest is local test
evidence only: database guards prohibit it from claiming an MBFD canonical
mapping or materializing an assignment observation. A reviewed rejected source
row remains immutable evidence without a mapping or observation; unresolved
unknown, ambiguous, incomplete-topology, and missing-observation findings
continue to block acceptance and publication.

`official` is an externally governed ingestion designation, not cryptographic
proof that a report is authoritative. The local staging helper has no HTTP
route, and a future authorized workflow must select that designation only after
policy-owner/source approval and retain the actor/reasoned ledger record.
`legacy_unclassified` is the fail-closed default for historical manifests that
lack this provenance contract. Ephemeral tests may simulate the official-path
database invariant with sanitized data; that is not a real MBFD baseline
designation.

## Operator surface and remaining gates

The Bid Setup page displays the selected lifecycle/revisions/settings and can
only call the designated configuration endpoint. New-session UI defaults to a
mock rehearsal; live mode is explicit and independently server-gated. Mock
boards hide generic live controls and use only the rehearsal freeze command.

The generic specialty workflow is a labelled, typed `TEST POLICY — NOT APPROVED
MBFD POLICY` exercised only against a mock session. Its separate
credential-name and specialty-code requirements are evaluated from the frozen
snapshot, not asserted by the operator. It is an engine/mechanics test and does
not establish an MBFD specialty ranking, pool, scoring, tie-break, or award
policy.

No current UI or source change creates the required MBFD Hub `bid.manage`
permission bridge, imports/reconciles real TeleStaff data, starts a live Bid,
or enables Employee Portal writeback. Keep
`PORTAL_WRITEBACK_ENABLED=false` and the portal writer absent until a separate
authorized production release.
