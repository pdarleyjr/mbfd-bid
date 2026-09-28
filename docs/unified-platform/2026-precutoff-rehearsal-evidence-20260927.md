# 2026 pre-cutoff rehearsal Mock: local evidence

Status: **completed local rehearsal, not final Bid acceptance**. Conducted 2026-09-27 in the production-shaped operator UI against local D1 and local Worker/Web. No Real session was created or started. Portal and staffing writebacks were disabled. The September 30 at 17:00 Eastern source cutoff had not occurred; this Mock cannot certify the final personnel or credential snapshot.

## Immutable context and result

| Item | Recorded value |
| --- | --- |
| Corrected rehearsal version | `01M3JQQZBG0HB62DG2HAQCH0BR` |
| Rehearsal version SHA-256 | `afc40fb96c566d104a53f2cb34d9ee6d40d5217e9de21e71f61a9f3ea2b6cbc3` |
| Mock session | `01M3JQS5AHAXJ7MZVJ031M353A` |
| Final canonical command sequence | 256, `live.complete_session`, `ready_for_finalization` |
| Results award source | `CANONICAL` |
| Corrected inventory | 223 opportunities: A 73, B 73, C 73, Days 4; CPT 23, LT 39, FF 161 |
| Frozen rehearsal bidders | 222: CPT 22, LT 39, FF 161 |
| Actual Mock awards | 201 unique members/seats: CPT 17, LT 39, FF 145 |
| Without award | 21 members: CPT 5, LT 0, FF 16 |
| Vacant seats | 22: CPT 6, LT 0, FF 16 |
| Expected capacity surplus | One CPT seat, assuming all 222 bidders can be awarded |
| Actual source-limited difference | Five additional CPT and 16 FF seats unfilled because the frozen candidate evidence did not establish qualifications for all specialty opportunities. The Mock did not manufacture eligibility to force a one-vacancy result. |

The Results API returned HTTP 200 with 201 canonical awards and valid provenance. `completion.verified` remained false with `mock_session_not_transitionable`, as expected for a Mock; specialty state reported `finalization_ready=true`. The completed board displayed 201 picked, 21 **without award**, and no active or On Deck bidder. This is an operational rehearsal result, not approval to transition staffing or Portal records.

The six unfilled Captain seats were `A212`, `A601`, `B212`, `B601`, `C212`, and `C601`. The 16 unfilled Firefighter seats were `A602`–`A606`, `B602`–`B606`, `C305`, and `C602`–`C606`. The Captain vacancies reflect Captain 5 and Marine restrictions; the Firefighter vacancies reflect Marine and the C305 Investigator opportunity. Exactly one of the 22 vacancies is the planned rank-capacity surplus. Further person-specific source review and the final cutoff snapshot are needed before attributing or resolving the other vacancies.

## Operator workflows exercised

The Mock was created and operated through `/admin/bid` and the related Results and export UI. The operator made and reviewed actual selections across Days Captain/Lieutenant, ordinary Captain/Lieutenant/Firefighter, Float Captain, Rescue Float LT/FF, Combat Float, Special Operations, Air Tech, DE, Fire Investigator, SWAT, and A-Day flows. B703 appeared in the Lieutenant sequence and received a Lieutenant award at command 52. B704–B706 appeared in Firefighter bidding and received Firefighter awards at commands 86–89. Marine roles were presented under the policy rules; no unsupported person-specific qualification was asserted.

The run exercised pass, unreachable contact, return, selection correction/amendment, specialty deferral, invalid scoped A-Day, and SWAT A-Day conflict. A B-shift SWAT attempt hit the shift maximum before C709 was selected. Another SWAT A-Day G1 attempt hit the scoped maximum before C110 G2 was selected. A DE A-Day G1 choice was correctly rejected by the Worker before member 98 received A402/G2. The Investigator's deferred A-Day choices were recorded after position turns: A305/G2 at sequence 254 and B305/G2 at 255, followed by completion at 256. Browser navigation/refetch showed the same completed canonical state. The export UI produced both progress and award files.

The local rehearsal does not itself prove a network disconnect recovery, transport-level duplicate replay, production authentication, or every Marine A-Day combination. Focused tests cover the idempotency and policy boundaries; production-shaped and final Mock acceptance still need explicit receipts for those workflows.

## Defects found and corrected during rehearsal

1. A returning bidder's PASS disposition targeted the waiting ordinary turn. The reducer and UI were corrected to use the current returned bidder. The recorded early PASS remains in this Mock's immutable history; the next command correctly passed the returned bidder. Focused reducer and UI tests now cover the behavior.
2. A DE scoped A-Day group was shown as available before the Worker rejected it with `SCOPED_A_DAY_MAXIMUM`. Shared frozen constraint evaluation and the operator projection were corrected. The operator then selected the valid group; focused UI and Worker tests passed.
3. An Investigator with a prior specialty award appeared again at an ordinary Firefighter position turn, where the Worker rejected a duplicate award with `MEMBER_ALREADY_SELECTED`. The turn queue now skips already awarded members and processes deferred A-Day turns after position turns. The old Mock contains an audited skip for that occurrence; the corrected queue advanced and both deferred A-Day choices completed. Focused reducer tests passed.
4. The placements CSV was empty despite 201 canonical awards, and progress counted legacy placement rows. Exports now derive awards from the canonical fills and event provenance, with a guarded legacy fallback. The UI re-export contained 201 unique award rows; focused integration tests passed.
5. On completion, the roster called unawarded bidders “remaining” and showed stale On Deck names. The completed board now labels them “without award”/“No award” and clears On Deck. The completed UI was refreshed and verified; focused component tests passed.

## Export integrity

The private CSVs remain outside the repository because they contain member information. The local progress export has one row with command sequence 256 and 201 committed awards; SHA-256 `4f22e57112d9dcdda96243b6ab62fcd1a7eb35dfcd752b961fe4115f14f1900b`. The local awards export has 201 rows, 201 distinct member IDs and position IDs, and the 17/39/145 rank split; SHA-256 `5e7842735303a2faf264aa05ad3b3830cdd1180a09c66608d2632b4bf496547c`.

## Release boundary

These results cover a local candidate with uncommitted rehearsal fixes. They are not a hosted CI receipt, staged or production deployment, authenticated production acceptance, final evidence freeze, final immutable Bid version, final Mock, Live Readiness authorization, or Real Bid start. The final 2026 application must remain source-bound at the exact `2026-09-30T17:00:00-04:00` cutoff and be reviewed again from its own frozen version/hash. Portal/staffing writebacks remain off for Mock sessions.
