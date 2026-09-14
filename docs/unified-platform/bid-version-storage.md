# Immutable Bid storage and run integrity

This implementation adds internal version storage and run preparation to the
existing Bid engine. It does not yet expose Save/Restore or adopt a production
year. The editing facade, managed-year legacy-writer guards, version-bound
completed-Mock review/publication, and new run-creation route remain integration
work. A saved edit is not authority to publish or start a Real Bid.

## Version identity and transaction

Migration 0059 adds `bid_definition_versions` and `bid_definition_heads`.
Every changed Save receives a new product ordinal, immutable content hash,
private rule book/template, and an immutable policy document when present.
The existing numeric book alias is allocated independently of the product
ordinal. The year designation is never temporarily or permanently retargeted
by this store. Final advanced rules and captured authoring provenance remain
separate; no implicit recompilation replaces a direct rule.

The canonical request, actor, operation and idempotency key identify one
receipt in the existing `admin_configuration_receipts` table. Receipt lookup
precedes mutable head/source checks so a successful retry returns its original
response after subsequent edits. Reusing a key for another intent conflicts.

A Save checks the expected head ID/revision/hash or the exact legacy capture
token. The first batch statement inserts one audit row only when both the
expected head and every captured source-control scalar still match. The
immediately following receipt statement requires `changes()=1`; a failed guard
raises a database error and rolls the entire batch back. Private material,
version and forward head update are in this same transaction. A lost response
is resolved by reading the exact receipt before reporting failure.

An ordinary semantic no-op adds only its audit/receipt. It creates no book,
template, policy document, profile revision or version. Restore always creates
a new identity, including when its content equals Current Bid. A subsequent
no-op retains the restored version's original lineage.

## Permanent seals

Version ownership, rather than current-head status, seals backing material.
INSERT, UPDATE and DELETE guards cover versions, topology, final rules,
participation, staffing bindings and policy documents. Replacement checks
cover both public IDs/unique indexes and SQLite's implicit rowid, including
when recursive delete triggers are disabled. Captured profile/source-decision
history also rejects replacement. The saved book and document publication
lifecycle currently remains sealed until the version/context-bound review
adapter is implemented; legacy publication cannot grant a saved edit authority.

SQL verifies relational identity and hash format. It does not compute SHA-256.
The version loader reparses the strict canonical bundle, recomputes its hash,
and compares its private backing rows. It never loads a previous version
through today's Current Bid pointer or mutable year-designated content.

## Run pins and context

Migration 0060 adds four nullable columns to the existing policy snapshots:
`bid_version_id`, `bid_version_sha256`, `snapshot_sha256`, `context_sha256`.
There is no backfill. Historical JSON and all pre-existing values remain
unchanged; historical provenance stays explicitly NULL. Newly inserted managed
snapshots require all four fields and matching session/year/version/backing
identities. Existing snapshots reject replacement; pinned snapshots and their
parent identity cannot be deleted or replaced. Lifecycle progress remains
mutable through its existing command authorities.

New V3 JSON carries `bidDefinition` with its session, year, version/hash and
context hash. The snapshot hash is stored only in the row and covers the exact
UTF-8 serialized bytes. The context hash covers frozen members, effective
evaluation dates, baseline, tenure, catalog and operator evidence. Capture
milliseconds and minted book/version aliases are excluded. A capture-date
fallback used by a legacy setting is still an actual evaluation date and is
included. Missing optional evidence is distinct from an empty collection.
Mock-only accepted-baseline participation evidence remains hash-significant;
it cannot be removed to manufacture equivalence with Live.

Run preparation selects an explicit saved version and reuses the existing
configuration validation, dated evidence, baseline, pool, eligibility and
rule-material freeze code. Saved source decisions come from that version.
Source controls are checked before and after preparation and returned for the
eventual creation transaction. Existing active-book/published-document Live
requirements remain in force; preparation itself is read-only.

Migration 0061 closes a reproduced capture race: a pending adverse credential
review could change its member/credential mapping without changing its review
classification or advancing the source revision. Identity-only changes now
invalidate the capture. Existing classification changes and applied resolutions
retain their original invalidation behavior without a duplicate increment.

The common snapshot loader verifies bytes, row/body/version identity, immutable
execution material and the recomputed context. It validates Version 1 after Version 2 becomes
current. The annual freeze path now uses that same loader. Canonical command
services verify managed integrity before receipt replay, reduction or writes.
They also compare a supplied Live policy to the frozen policy.

## Durable Object recovery

A managed DO records the verified four-field pin tuple before its first local
projection, during initialization or a canonical command. Managed recovery
checks the tuple against D1 before projecting canonical state or returning a
cached snapshot. Missing, malformed or mismatched managed provenance fails.
Canonical intent recovery remains guarded through the canonical state loader.
Legacy sessions with neither marker retain their existing local-only snapshot
recovery behavior. A D1 outage does not silently downgrade a managed marker to
legacy state.

## Validation and remaining release gates

Tests use synthetic, isolated databases with real foreign keys and migrations.
They cover full material adoption, canonical no-ops, restore lineage, competing
saves, lost responses, failure at every batch statement, ID/rowid replacement,
unchanged historical rows, old-version stability and tampering even after
recomputing a snapshot checksum. SQL admission, pure pin validation, run
loaders, canonical commands and DO recovery are tested as separate boundaries.

Passing these tests does not establish normative 2026 policy parity, private
historical replay approval, account-holder acceptance, deployment or physical
operator acceptance. Before production migration, the release still requires
the exact reviewed SHA/tree, green CI/CodeQL, a migration rehearsal, a fresh
private recovery export/receipt, D1 recovery bookmark, and release identity.
No new UI should expose adoption before competing legacy writes and managed
run creation/publication are integrated and verified.
