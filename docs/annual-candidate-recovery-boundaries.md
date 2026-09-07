# Annual candidate compatibility and recovery boundaries

This is a release preparation record, not authorization to bypass the guarded migration workflow or a claim that recovery has been rehearsed.

Migrations 0045–0055 add annual authoring and evidence tables and integrity triggers. Local fresh and populated-upgrade tests preserve existing identities, assignments and frozen snapshot bytes. Existing V1/V2/V3 readers remain in the candidate. New optional material in the strict V3 schema is forward-readable by this candidate but is **not** readable by the accepted pre-candidate reader after the new fields are written.

A local parser comparison against exact base `9a3fbf09f543c73c0c0e0a0809ca61d8da65ef35` used a valid synthetic historical V3 snapshot. Both readers accepted the historical shape. Adding `authoringCredentialNames`, `tenureEvidence` or `settings.personnelEvaluationOn` caused the old strict reader to reject unknown keys while the candidate accepted them. This demonstrates a compatibility boundary; it does not qualify either deployed runtime.

The release record must distinguish two recovery points:

A second local probe ran the exact base application against the complete migration chain through 0055 with foreign keys enabled. Creating a synthetic credential returned 201 and changing only its points returned 200. Renaming its policy name returned 500 because the new immutability trigger rejected the old writer; the original name, points and audit count were preserved, and the foreign-key check was clean. This is a demonstrated old-writer incompatibility **before candidate writes**, not a successful rollback rehearsal. Migration and application cutover must account for this interval, and recovery must use a compatible application or an explicitly approved database recovery. The trigger must remain enabled.

1. **Before candidate writes:** capture the approved database backup and Worker/Web identities through the existing controlled procedure. Validate the prior runtime against the migrated-but-unwritten copy, including new triggers. Merely applying additive SQL does not prove old writers remain compatible.
2. **After candidate writes:** use a recovery candidate whose reader understands every persisted field, or an explicitly authorized database recovery with an accounted-for write window. Redeploying the old Worker against newly written snapshots is not a qualified rollback. Never remove new fields from historical snapshots, drop evidence tables, disable integrity triggers or discard intervening administrative writes to force compatibility.

Before production migration or deployment, the final exact candidate still requires hosted gates, no competing release authority, no active Real Bid, fresh backup/restore evidence, ledger verification, approved migration execution and paired Worker/Web runtime acceptance. Freeze and Mock acceptance remain separate from source tests. No SQL down-migration or production recovery has been executed for this candidate.
