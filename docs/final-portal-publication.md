# Final 2026–2027 employee assignment publication

The final V4 workbook is the placement target. Its required SHA-256 is
`67885033bd9b4ee9de5be5b6806c64b3744befc5ecf61bfedb69cc471a0843e5`.
Use existing audited canonical commands to reconcile and complete the Real
session before preparing publication. This feature never replays awards,
manufactures retained bids, edits frozen topology, or supplies workbook pick times.

Deploy the secured Hub receiver first. Apply migration
`0072_final_portal_publication.sql` through the controlled per-migration Release
Captain procedure before the protected Bid release. The deployment workflow
checks the exact migration ledger and refuses pending migrations.
Keep outbound publication disabled until the dedicated writer credential,
HTTPS Hub endpoint and receiver behavior are verified. Existing production
publication policy remains controlling.

Provision the dedicated `mbfd-bid-portal-writeback-production` queue and
`mbfd-bid-portal-writeback-production-dlq` before deploying their reviewed
producer/consumer bindings in `apps/worker/wrangler.toml`. No unrelated queue
may be reused. The Worker producer binding is `PORTAL_QUEUE`; the consumer
uses batches of 20, a five-second batch timeout and three platform retries.
Outbox delivery retains the existing per-assignment retry budget. Missing
queue bindings reject publication before its transaction. A disabled Worker
acknowledges incoming messages without any external POST; its durable outbox
remains available for reconciliation after publication is enabled.

Prepare a private JSON request conforming to `FinalPublicationBodySchema` in
`apps/worker/src/portal-writeback/final-source.ts`. Retain each worksheet row,
employee ID, seat and exact source description. Include the current canonical
result package hash and sequence plus the SHA-256 of the independently verified
Hub identity readback and all 226 matched employee IDs. This identity receipt is
an administrator attestation to the prior canonical Hub readback; preview does
not query or alter Hub accounts. Never save the workbook or request in Git.

If a final workbook seat description differs from the saved session wording,
include `frozen_position_label` and an explicit `metadata_override_reason`.
Preview displays each difference. The confirmed immutable source manifest
supplies the final display wording to Bid boards, Current Bid Results, Shift
View and result packages at the same canonical sequence. Original frozen
definitions, ranks in the audit, awards and event lineage stay intact.

In Bid reports for the explicit Real session, open Portal sync status and
upload the private request. Preview requires fresh administrator authentication,
218 canonical awards, eight exact retained seats, final A-Days, all source
checksums and identity coverage. It performs zero writes and remains available
while outbound publication is disabled. The endpoint is
`POST /api/admin/portal-final/{sessionId}/preview`.

Publish requires the displayed exact confirmation phrase and enabled production
publication policy. `POST /api/admin/portal-final/{sessionId}/publish` commits
the receipt, 226 durable outbox rows, prior-revision supersession and audit
atomically. A canonical sequence race or audit failure rolls back the batch.
Repeating the same publication cannot create another assignment row. Queue
send failures retain the outbox for the existing daily reconciliation cron.

The existing Queue consumer, HTTPS client and retry policy deliver V2 records.
Accepted canonical command events supply actual award timestamps; retained
assignments have `picked_at: null`. Messages must exactly match immutable
outbox bytes and identity. A changed canonical sequence supersedes stale
deliveries before any POST. The Hub must reject lower sequence corrections
and acknowledge exact duplicate delivery with 409 `code: already_recorded`.

`GET /api/admin/portal-status/{sessionId}` includes final assignment queued,
in-flight, done, failed and superseded totals. A fresh administrator can retry
a current failed outbox row with
`POST /api/admin/portal-final-retry/{outboxId}`; older canonical revisions cannot
be retried. Reconcile all 226 Hub records field by field after delivery.

Rollback code/config by the established release mechanism, disabling outbound
publication first. Keep these additive tables and the Hub assignment history.
Do not drop receipts, remove outbox rows, reverse canonical commands or erase
accepted history as a UI rollback. A subsequent audited correction requires a
new completed canonical sequence and a newly reviewed source request.
