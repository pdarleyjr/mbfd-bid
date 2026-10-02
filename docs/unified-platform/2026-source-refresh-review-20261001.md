# October 1 source review

The exact archive and workbook identities are recorded in `2026-source-refresh-manifest-20261001.json`. The October archive contains two updated workbooks with the same filenames as earlier copies. Comparison covered sparse cell values, expanded shared formulas, cached results, dates, sheet structure, stable employee identities and both source and sorted role tables. Original files were read only. No native Excel recalculation, production import or production write was performed.

The MASTER `Positions` and `Personnel` sheets are unchanged from the independently verified standalone V4. The Annual workbook keeps credential Versions 1–4 unchanged and adds Version 5 with 3,884 rows for the same 230 employees. Employee rank sets, seniority, TeleStaff rows, requirements and governing rule sheets are unchanged. Updated test examples are not bid awards or current personnel authority. The older archive's omitted policy PDF and assignment export retain their separate authority; absence from the new ZIP does not revoke them.

## MASTER summary formulas

Ten existing formulas change, and one assigned-member counter is added:

| Cells | Change | Meaning |
| --- | --- | --- |
| A/B/C Shift - Bid `AF22` | Add `Q5` | Include the Station 3 Lieutenant in the assigned-Lieutenant summary. Each shift now sums all 12 raw Lieutenant markers. |
| A/B/C Shift - Bid `Y22` | Add `C12:C17` | Include Station 1 Rescue 1 and Rescue 11 assigned members in the Rescue summary. |
| A/B/C Shift - Bid `AL23` | Use `AL4:AL9,AL12:AL22` | Count the six Rescue Float and eleven Combat Float markers, including the previously omitted final Combat Float rows. |
| A Shift - Bid `Q21` | Add `AL23` | Include the side Float pools in the assigned shift total. B/C `Q21` still omit `AL23`. |
| C Shift - Bid `X4` | Add `IF(Z4<>"",1,"")` | Restore the Station 4 Captain assigned-member marker. Moving the shared-formula anchor leaves the effective `X5` formula unchanged. |

These markers evaluate selected member presence. Their empty or zero cached values are occupancy, not capacity. The raw MASTER contains 228 position rows and raw Lieutenant labels A12/B12/C12/D4. The separately reviewed B703 Lieutenant correction and closed D401/D402 assignments yield 39 open Lieutenant opportunities. Neither a summary marker nor source-row arithmetic proves a Lieutenant staffing shortfall or determines Real Bid readiness. The application continues deriving capacity from explicit position participation and approved role decisions.

The only member-looking MASTER changes are 565 value cells and eight added cells in `Test Data`. No actual award or personnel import is inferred from them. Fifty-three existing cached `#REF!` errors remain in A-Day and Statistics sheets. They are not new failures caused by this update and are not authoritative inputs to the application.

## Credential changes and preserved holds

Version 4 to 5 changes evidence for 24 employees: 13 added credential keys, 13 omitted Public Safety Diver keys and two same-key date corrections. The added names and aggregate counts appear in the manifest. Removed and newly added keys concern distinct people; they are not same-person credential renames or renewals.

All 13 added keys match one existing member and one active catalog identity in the original approved evidence. The normal date classifier finds nine new qualifications and four missing-date fills against those original intervals. This is an identity/mapping and prior-ledger comparison, not approval or a claim to have queried later production state. The prepared Version 5 CSV passed the actual upload parser with 3,884 rows and 230 exact employee identities; its receipt binds the original workbook hash and worksheet.

All 13 omitted PSD records were already expired in the original approved TargetSolutions lifecycle ledger. Their recorded source expirations exactly match the approved intervals in July or August 2026. The existing qualification projection reports all 13 expired at both September 30 and October 1; none was an active sealed qualification. Omission therefore requires no invented revocation and creates no terminal event. This proof uses the immutable original ledger; it does not claim to have read later production events.

One Open Water issue date changes from 2000-06-02 to 1996-06-29. One PSD source expiration changes from 2099-05-07 to blank, with its 2023-05-07 issue date preserved. The previously held 2029 PSD interval is unchanged. Both held assertions originally had no approved dated PSD event and undated compatibility baselines. A corrected source row must pass normal audited review and produce appropriate approved dated evidence before an existing hold can resolve; merely changing a workbook or rejecting an old assertion does not clear it. Historical source rows remain intact.

Normal import review now checks the same unresolved-hold projection used by qualification evaluation. An unresolved member/qualification pair stays `CONFLICT`, preventing both safe bulk apply and blanket adverse approval from creating an event that implicitly clears the hold. Unrelated safe rows can still apply. A later individually approved dated event that legitimately resolves the hold permits normal renewal. The earlier Open Water issue date remains a date conflict requiring individual correction.

## Marine score correction and limits of cached lists

All 235 formula edits are `Points!FP5:FP239`. The branch for required total five now adds `FM` and `FN`, matching the other branch's treatment of diver and Car Seat preferences. Every new cached FP total agrees with the exact edited arithmetic. Thirty-two employee totals change; 17 of the same 18 Firefighters with required total five change, producing sixteen totals of seven, one of six and one of five. Subtracting the unchanged required total leaves the intended two, one or zero optional credits. Their new source ordering also matches the existing comparator's reviewed department-service ordinals when evaluated on those preference totals. This is a score and ordering check, not qualification approval.

The existing policy scorer already includes one DRI-or-PADI credit and one Car Seat credit, capped at two, for Deckhand and Float roles. It awards diver credit once when both issuers are held, rejects generic PSD/Dive Rescue 1 as issuer proof, and returns ineligible with zero points when any required qualification is missing. No engine scoring change is needed. Focused regressions cover these cases across all three shifts and verify that two preferences outrank one before seniority.

The spreadsheet's unchanged Marine rank and probation formulas reference credential columns `W` and `X`, rather than rank `D` and probation `E`; all 235 cached Marine Include flags remain `No`. The Deckhand Include formula also tests optional-inclusive FP rather than required-total FO. These formulas cannot supply application eligibility or allow optional points to replace a minimum. Generic MMC, IADRS and PSD labels still do not prove OUPV authority, a passing watermanship result or diver issuer.

The complete source/sorted-table comparison also found cached inconsistencies: seven Air Tech source-score rows changed while its sorted output stayed unchanged; 21 Captain 5 bid-order labels changed without score or member-row changes; Prevention Lieutenant row locations moved without member-value changes. Marine Deckhand source scores changed for 29 Firefighters and sorted-row positions moved for 55; qualification/scoring effects must be separated from list reordering. Annual `Certifications RD` retains twenty cached `#N/A` lookups: paired ID/points lookups for nine Handtevy Instructor records and one IAAI-CFI record. The Version 5 source records remain available independently of those broken derived lookups. Cached role lists are therefore comparison evidence, not a replacement for canonical qualification evaluation.

## Admission and historical boundary

`latest2026SourceCutoffIssue` keeps the original September hashes and Version 4 contract. The dedicated `latest2026ReviewedSourceUpdateIssue` checks only the exact October MASTER/Annual hashes, credential Version 5 worksheet, 3,884 rows, 230 employees and complete audited row review. Approved and rejected rows both count toward finished review; unresolved rows do not. Existing required personnel corrections remain checked, without adding invented participant targets or personal rank overrides.

The dedicated guard is intended for the explicit append-only reviewed-update capture. It does not rewrite the original freeze, move the original September cutoff or repin existing sessions. All existing source decisions and person-specific evidence requirements remain applicable. This comparison and manifest establish neither final source acceptance nor Real Bid readiness.

The server-owned `withOctober1ReviewedSourceDecision` transformation adds only fixed manifest provenance to the already resolved latest-ranks source decision. It preserves the prior reference, every other decision field and all other issue records. Missing, open, duplicated or unaccepted prior provenance cannot be transformed. This allows an explicit update capture to bind its transformed bundle for a later normal Save, rather than requiring a pre-capture edit to an old pin.

Executed validation covers 94 unit/integration cases across six files, including the migrated-D1 safe-apply failure reproduction, unchanged held source/legacy witnesses, unrelated-row progress and renewal after genuine dated resolution. Six private exact-source cases verify prepared CSV parsing, additions and source score-channel/order conformance. These local proofs do not substitute for hosted CI, deployed source identity or authenticated production acceptance.
