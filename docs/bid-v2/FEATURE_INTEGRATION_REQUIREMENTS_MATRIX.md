# Feature integration requirements matrix

This matrix records the integrated feature candidate's source-level policy
coverage. It is not an approval to publish a rule book, create a real Bid
session, deploy, migrate D1, or enable portal writeback. `UNRESOLVED` facts
remain fail-closed; a configured mechanism is not a policy decision.

| Requirement | Confirmed | Configured | Tested | Unresolved | Blocks live | Source-level disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 2026 stage order: D Captain, D Lieutenant, ABC Captain, ABC Lieutenant, ABC Firefighter | Yes | Yes, versioned annual operations policy | Yes | No | No | `ANNUAL_2026_STAGE_ORDER` and frozen policy validate the required order; it is not a permanent hard-coded policy. |
| Seniority: lower number wins; duplicate or missing values fail closed | Yes | Yes | Yes | No | No | Frozen policy/readiness and canonical command guards retain deterministic ordering; no random or Employee-ID fallback. |
| Contact attempts and unreachable declaration | Yes: three phone/text attempts and coordinator action | Yes | Yes | “Usually 15 minutes” semantics | Yes | The time rule is absent from confirmed policy and must be explicitly configured before live operation. |
| Hold, pass, defer, skip, decline | Partly | Yes, as explicit dispositions/action grants | Partly | Exact operational semantics and authority matrix | Yes | Keep action grants explicit and fail closed until Command Staff supplies the approved matrix. |
| Preference sheets and operator-confirmed next-valid choice | Yes | Yes | Yes | No | No | Frozen sheet, provenance, ordered positions/A-Days, next-valid preview, and no silent auto-award are represented. |
| Late return at current sequence; no rewind | Yes | Yes | Yes | No | No | Annual state preserves committed sequence and return handling. |
| Checkpoint, reconnect, replay, eviction recovery | Yes | Yes | Yes | No | No | Checkpoint and canonical durable-state recovery are retained; physical/operator acceptance remains separate. |
| ABC A-Day groups 1–4 and 18–19 capacity | Yes | Policy seam only | Partly | Per-group distribution and final topology | Yes | No per-group 4/3 distribution is inferred. |
| Captain/DC, LT, and D-shift A-Day capacities | Partly | Policy seam only | Partly | Exact officer and D-shift topology/capacity data | Yes | D-shift is explicitly division x weekday; weekends are unavailable only when supplied by approved policy. |
| Marine Assigned/Float limits and six-seat topology | Partly | Limits configured; topology required | Yes | Final position identifiers and policy source | Yes | Assigned and Float remain distinct. Stale `Post St.6` is not introduced as a seventh seat. |
| SWAT membership/distribution | Yes | Limits configured | Yes | Exact membership facts and any dedicated IDs | Yes | No dedicated position is invented; certified/trained and A-Day/medic constraints require approved input. |
| Rescue | Partly | Policy seam | Partly | Final Rescue/Float eligibility and topology | Yes | No special A-Day cap is invented. |
| 810 / Air Tech | Partly | Policy seam | Partly | Final position IDs/call-down and credential source | Yes | Station 2, one per shift, DE and credentials need approved configuration. |
| DE | Partly | A-Day maximum configured | Yes | Final IDs, call-down and six-plus-two-float topology | Yes | The implementation does not convert incomplete topology into eligibility. |
| Fire Investigator | Partly | Policy seam | Partly | Current credentials, secondary factors, reverse-seniority rule | Yes | No credential facts or tie-break values are fabricated. |
| Reserved/non-biddable positions | Partly | Yes | Yes | Combat Float, PMD/probationary, union-president, XX215, Station 4/6 and final IDs | Yes | A211/B211/C211 are `ADMIN_ASSIGNED_NON_BIDDABLE`; this does not generalize to all Division Chiefs. |
| Temporary assignments | Yes for Special Assignment and Light Duty only | Yes | Yes | Destination staffing count | Yes | Underlying assignment/A-Day/annual eligibility are preserved, daily vacancy remains separate, unsupported categories fail closed. |
| Credential evaluation date | Required | Yes, frozen V3 field | Yes | Actual 2026 calendar date | Yes | A real session cannot use an implicit evaluation date. |
| Explicit live action grants | Required | Yes | Yes | 2026 approver/member matrix | Yes | Admin access is distinct from a frozen action grant. |
| Annual completion to Post-Bid handoff | Yes | Yes | Yes | No | No | Only verified REAL canonical completion with final A-Day, no unresolved members, and sealed source may initiate Post-Bid. |
| Approval matrix | Required | Configurable/fail-closed | Yes | Approved actors and roles | Yes | Completion, approval, and publication remain distinct state transitions. |
| Effective date / approximately two-week rule | Yes: policy driven | Yes | Yes | Whether it is hard minimum, target, or warning and exact duration | Yes | `HARD_MINIMUM`, `TARGET`, and `WARNING_ONLY` modes prevent an unconditional 14-day assumption. |
| TeleStaff package and reconciliation | Yes | Yes | Yes | Handoff method and final reconciliation-before-publication rule | Yes | TeleStaff is observed/reconciled source material, never the canonical assignment model. |
| Portal writeback | No | Disabled/unsupported | Yes | Whether/when it is authorized | Yes | `PORTAL_WRITEBACK_ENABLED` remains false; no writer credential or browser automation is introduced. |
| Final topology workbook | No | Reference required | Yes | Reviewed authoritative 2026 topology/workbook | Yes | Missing or incomplete topology blocks a real annual session and final transition. |

## Preserved security and next SSO boundary

- Hub remains the human-auth authority. The integrated candidate does not add a
  Bid password system, infer admin authority from rank/title/Employee ID, or
  turn admin access into a live action grant.
- The existing Bid login request/response compatibility schemas, local-admin
  compatibility, legacy credential bridge/telemetry, callback handling,
  REST/API auth middleware, WebSocket ticket issuance/validation, and
  staging-role override are deferred to the final SSO Completion phase.
- The authoritative next-phase Hub baseline is
  `a69489ef2583c6278d5ff5da867404a4e4d2cdcf`. This candidate intentionally
  does not implement its revalidation or freshness contract.

## Integration ownership map

| Domain | Canonical integrated surface | Compatibility decision |
| --- | --- | --- |
| Live commands, receipts, audit, outbox and replay | canonical command service, reducer and `BidSession` durable state | Retained Worker 1 as the only live mutation path. |
| Annual policy, contact, preference and completion | annual operations library plus frozen V3 policy/state | Retained Worker 3; Post-Bid consumes canonical completion, not historical bids or mock seed data. |
| Personnel reviews and temporary overlays | year-round routes plus `temporary_operational_overlays` | Retained only Special Assignment and Light Duty persistence; the preview rejects unsupported temporary categories. |
| Future roster, package, reconciliation and publication | post-Bid transition route and completion-result projection | Retained the completion bridge. TeleStaff reconciliation cannot rewrite canonical final results. |
