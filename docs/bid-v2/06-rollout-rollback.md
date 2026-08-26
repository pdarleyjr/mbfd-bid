# MBFD Bid v2 rollout and rollback gate

## Current status

No staging or production rollout is authorized from this baseline. The repository has unresolved test, policy, security, workflow, and topology gates.

**Fail-closed backup gate:** every observed Actions D1-backup run failed before calling Wrangler because the script relied on an unset runner `TEMP` variable. Until the source fix, a manually authorized staging backup, object/hash/size verification, and a disposable restore test all pass, no D1-mutating rollout has rollback proof.

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
