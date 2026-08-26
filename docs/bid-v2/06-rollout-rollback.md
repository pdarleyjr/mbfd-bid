# MBFD Bid v2 rollout and rollback gate

## Current status

No staging or production rollout is authorized from this baseline. The repository has unresolved test, policy, security, workflow, and topology gates.

**D1 recovery evidence:** the source preflight was corrected and an authorized
staging export was imported into a disposable Bid-only D1. Schema, migration
ledger, queryable table counts, and foreign-key results were compared; the
disposable database was migrated by raw 0020 SQL and restored through D1 Time
Travel before deletion. The actual staging database was never restored or
migrated. This proves a controlled recovery procedure, but not a managed
staging migration: raw execution did not advance the migration ledger and the
temporary export still requires secure manual deletion.

The current staging-deploy workflow applies remote D1 migrations without a pre-migration backup checkpoint. Do not repair that ordering by adding an unverified automated backup call; first prove the repair and restore procedure in a controlled staging operation.

## Required pre-change record

- Git SHA, branch, reviewed diff, CI result, and source-register status.
- Worker/Pages version and routing evidence.
- D1 schema, backup/bookmark or equivalent recoverable state, migration plan, and restoration test.
- Bid resource ownership, service limits, and isolated container plan if a server component is ever added.
- Media Control precheck for every potentially shared server/Cloudflare change.

## Rollback model

| Layer | Required rollback evidence |
| --- | --- |
| Code | Prior reviewed SHA and deployment provenance. |
| Worker/Pages | Previous version/deployment reference and safe traffic/routing procedure. |
| D1 | Verified restore mechanism appropriate to the mutation; additive/reversible migration where practical. |
| Feature | Feature flag or disable path that preserves canonical data. |
| Server AI broker | Stop/disable only the dedicated Bid workload; no shared Docker/runtime action. |

## Prohibited recovery actions

No rollback may restart, recreate, stop, or reconfigure Media Control; restart Docker/containerd; execute global cleanup; or edit a shared tunnel/DNS/Access resource without independent approval and impact proof.
