# 2026 Bid live readiness and decisions

Last release review: 2026-09-28 15:30 Eastern. **PRE-CUTOFF PRODUCTION TESTING IS AVAILABLE; REAL BID IS NOT READY TO START.** The September 28 functional production release source was `e60c03a30f0063c52997a373576f7998d132f8b5`; this documentation/visual-help correction began from that exact main commit. The September 28 production Mock, repaired audit exporter, repaired canonical-roster PDFs, and image-led pre-cutoff guides are available. A subsequent documentation commit may advance `main` without changing the recorded functional production source; verify the deployed Worker/Web version IDs below rather than treating this historical SHA as a permanent branch head. The September 30 17:00 Eastern evidence cutoff and final evidence-certified version/Mock remain open. This is the current decision register; `2026-final-bid-reconciliation-gate-20260926.md` and `2026-precutoff-rehearsal-evidence-20260927.md` are historical candidate/local rehearsal reports. The current [September 28 release acceptance receipt](2026-precutoff-production-acceptance-20260928.md) is part of this repository and also preserved at `E:\Organized Files\BID Software\03 - Pre-Cutoff Mock Evidence\2026-09-28 PRE-CUTOFF RELEASE ACCEPTANCE.md`.

## Source hierarchy and exact artifacts

The final July 2026 Bid Policy controls Bid rules. The final MASTER is preserved as the raw 2026 organizational source. The administrator's 2026-09-27 reviewed source decision explicitly corrects the B703-B706 application roles using current assignment evidence, the B-shift roster, the historical B-shift diagram, and rank-capacity reconciliation. The raw workbook and its hash remain unchanged. No numeric position ID or arithmetic balance alone changes role identity.

| Source | SHA-256 | Use |
| --- | --- | --- |
| `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder\2026 Bid Policy.pdf` | `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc` | Final July policy |
| `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder\MASTER 2026 Bid Positions Selection V2.xlsx` | `0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a` | Final seat topology, Positions row 134 for B703 |
| `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder\2026 Bid Shift Template.pdf` | `db5101dbc40d9f43a066220465fe7c187b183a31e0f64bca8dc158172cb701cf` | Corroborates B703 Firefighter label |
| `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder\2026 Annual Bid Calculations v3.xlsx` | `dcd5d13e91a4889157a54074335b87105765e6e0cd8aa1828542bec313133f58` | Calculation and legacy rule comparison; Statistics contains `#REF!` and cannot correct seat identity |
| `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder\(EX) Export Assignments - 2026-08-24.xls` | `1adb6c119dd08b3812b0b282647e37a04c2d85e60cb1dacb75fdbaaefcfc0354` | Assignment/occupancy evidence |
| `E:\Organized Files\Miscellaneous\Images\b_shift_2025.png` | `0c574fabece84e43919b7eb0c2b20478160b4649bbd49bcaeaefc405d1034a07` | Historical B-shift structure |

## Position and participant reconciliation

The deterministic audit is `2026-rank-capacity-candidate.json`. It lists all 231 organizational roles, including the 223 biddable opportunities, source identities, shifts, station/unit/role, rank, specialty family, participation, authority, and corrections. The corrected candidate has 73 biddable positions per A/B/C shift and four open Days positions. Division Chiefs, Union President, and closed Days positions are non-biddable.

| Scope | Captain seats | Lieutenant seats | Firefighter seats | Total |
| --- | ---: | ---: | ---: | ---: |
| A | 7 | 12 | 54 | 73 |
| B | 7 | 13 | 53 | 73 |
| C | 7 | 12 | 54 | 73 |
| Days | 2 | 2 | 0 | 4 |
| Reviewed application total | 23 | 39 | 161 | 223 |
| Reviewed bidder cohort | 22 | 39 | 161 | 222 |
| Expected vacancy | 1 | 0 | 0 | 1 |

**RESOLVED source conflict:** Raw MASTER Positions rows 134-137 label B703-B706 `Firefighter #1/#2/#3/#4`. The reviewed application correction labels B703 `Lieutenant #3 (R)` and B704-B706 `Firefighter #1/#2/#3`. B701/B702 remain Lieutenants #1/#2. The role classifier and rules now make B703 a `RESCUE_FLOAT_LT` Lieutenant opportunity and B704-B706 `RESCUE_FLOAT_FF` Firefighter opportunities. The predecessor crosswalk retires the old fourth FF role; it does not transfer that role's references to the new Lieutenant. The application audit records both raw and corrected values for each affected row. The 223 opportunities reconcile with 222 reviewed bidders and one expected Captain vacancy. Final bidder counts still require the September 30 evidence freeze.

## Rule authority decisions

| Topic | Current decision | Authority and boundary |
| --- | --- | --- |
| Rescue Float LT/FF | Paramedic minimum | Final July policy Procedure 11(b) |
| Captain 5 and closed Rescue Days Captain | Paramedic and 36 cumulative Rescue Division months | Final July policy Procedure 6 |
| Ordinary Rescue, including Station #2 Rescue | No Paramedic Bid minimum imposed in the corrected draft | No positive ordinary-Rescue minimum found in final July policy or supplied calculation workbook; assignment needs do not create a Bid restriction |
| Station #2 Special Operations | Six Operations points, six Technician points gated on all six Operations, Part 107 point | Final July policy Procedure 7; role-by-role scoring tests cover ordinary Combat/Rescue, DE, Captain 5, Air Tech, both Float Firefighters, Rescue Float Lieutenant, and Float 2 Captain |
| Marine Open Water only | DRI PSD by 2027-01-24 if winner starts on 2026-10-24 | Final July policy Procedure 8(f)(i) |
| Marine PADI PSD, no DRI | DRI transition for continuing education, training and renewal; no fixed three-month deadline | Final July policy Procedure 8(f)(ii) |
| Marine DRI already held | No redundant transition | Final July policy Procedure 8(f) |

The two Marine obligations are separate immutable rule terms. The no-deadline term remains pending until an audited review records completion. Generic MMC, IADRS, or Public Safety Diver labels do not prove OUPV authority, a passing watermanship result, or a DRI/PADI issuer. Person-specific evidence remains blocked unless separately verified. Current HazMat Operations may satisfy Awareness in the approved one-way direction only.

## Engineering and operational gates

The release resolves employee `18148` by stable employee identity with a unique-match guard. Position remapping touches schema-declared references and leaves narrative/source text intact. The unused zero-holder `NFPA 1123` duplicate was retired through the authenticated production catalog UI on 2026-09-27 at 19:24 Eastern; audit sequence 409 attributes the retirement to actor `credential:619`. The canonical `NFPA1123 Outdoor Fireworks` remains active. Operator authority and Real-only settings have versioned UI/review controls; authenticated production preflight displays the saved grants.

The approved evidence cutoff is **2026-09-30 17:00 America/New_York**, equal to `2026-09-30T17:00:00-04:00`. It is later than this review. The annual settings now carry `evidenceCutoffAt` separately from the calendar evaluation date. A typed `evidenceFreeze` can seal approved source import IDs/revisions/hashes and the personnel and credential snapshot hashes and capture/approval times. Database triggers keep an immutable log of relevant source writes from the cutoff until the freeze is sealed; a delayed capture remains possible only if there were no such writes and source approvals precede the cutoff. The final evidence freeze is still pending; a current date-only projection cannot prove which same-day changes were accepted by 17:00. An OPEN final-evidence-certification decision permits a clearly labeled rehearsal Mock while blocking Live activation.

### September 28 production release and recovery

PRs #206 and #207 are merged. PR #207 passed hosted CI, Playwright, lint/typecheck and CodeQL. The September 28 functional deployed source is `e60c03a30f0063c52997a373576f7998d132f8b5`; production Worker version is `379cd616-c972-4281-bb05-baaa9fad9983` and Web version is `4fa1ed4f-ebf4-441e-892e-b6bb54d7524a`. The web build tree matches the merged tree `15867f8446d7bf57fe910a818764d9ec545f6220`. Production `/api/health` returned HTTP 200. The predeployment private D1 backup is `r2://mbfd-bid-prod-backups/d1/2026-09-28/mbfd-bid-production-2026-09-28-1303.sql` with matching `.recovery.json` receipt. The production migration guard passed 69 canonical migrations.

GitHub production deployment run [36456132506](https://github.com/pdarleyjr/mbfd-bid/actions/runs/36456132506) failed Cloudflare authentication because its repository `CLOUDFLARE_API_TOKEN` is invalid. The exact release succeeded with approved local Cloudflare authentication. A read-only GitHub credential/D1/deployment preflight workflow has been prepared; repository credential repair and a passing hosted run remain open. The locally supplied Wrangler CLI token also failed Cloudflare verification with HTTP 401, so it must not replace the GitHub secret. This credential failure does not change the verified live Worker/Web version IDs.

Saved pre-cutoff Version 9 is `01M3K2YJFQ46Y8BZ5PH3GQKCQ0`, SHA-256 `afc40fb96c566d104a53f2cb34d9ee6d40d5217e9de21e71f61a9f3ea2b6cbc3`; it is not the final post-cutoff version. The authenticated production Managed Live preflight blocked on D102-D104 appointment/term-start evidence and created no Real session. Portal and staffing writeback remained disabled for Mock.

### September 28 production Mock and issued guides

Production Mock `01M3M47EY3ACZN1S1XQ66Z12JG` completed at canonical sequence 228 with 222 bidders, 199 simulated awards, 23 no-award dispositions and 24 open seats. The independently checked placements CSV has A 65, B 65, C 65 and Days 4 awards. The repaired full audit exporter produced `audit_full_1790617947951.csv.gz`, SHA-256 `5c40db2575c75424b13853bbb51279bb9bd1f15367e62b8ffaac32aa27919e04`; decompression and CSV validation found 239 distinct audit records, including 199 `live.record_selection` and 24 `live.disposition` actions. Four regenerated canonical-roster PDFs in `E:\Organized Files\BID Software\03 - Pre-Cutoff Mock Evidence\VERIFIED - September 28 Roster PDFs` each display the Mock/session/sequence and reconcile exactly with the placements CSV at 65/65/65/4 awards. The four earlier all-VACANT PDFs are quarantined in `INVALID - September 28 Roster PDFs` and remain invalid even if visible in historical export listings.

The image-led `MBFD 2026 BID - PRE-CUTOFF Testing and Training Guide.pdf` and `.html`, eight-page `MBFD 2026 BID - Bid Day Quick Reference.pdf`, and `MBFD BID - Master Administrator Guide.pdf` and `.html` are issued under `E:\Organized Files\BID Software`. The signed-in production app serves 58 canonical help topics at `/admin/docs`; significant administrator workflows are mapped to distinct annotated captures in the [31-row visual coverage matrix](2026-feature-visual-coverage-20260928.csv). The documentation manifest records figure-level source SHA, capture time and release rather than a false common capture SHA. These are pre-cutoff operator guides, not evidence that every manual path has passed. The September 28 Mock left Fire Investigator seats A305/B305/C305 unfilled in **volunteer/simulated Mock coverage**; this does not establish a final staffing shortage. The frozen Version 9 policy includes one currently-assigned, minimum-qualified, reverse Firefighter department-service ordinal tier for those seats. Its source decision is `Qualified fallback — fire-investigator · RESOLVED` under Procedure 3(e). The completed Mock's A305 panel showed zero eligible available candidates and `FALLBACK_TIERS_EXHAUSTED`. A read-only production D1 check of that exact frozen snapshot found 161 Firefighters, five with both frozen minimum credential labels, and **zero** with a `currentBidPositionIds` binding; the live Department table has 155 Firefighters with active assignments but **zero** with an approved `position_staffing_bindings` link. A305/B305/C305 have no binding rows. This is an evidence-mapping blocker for the current-assignee tier, not proof that no current Fire Investigator members exist. Reconcile the authoritative assignment-to-Bid crosswalk, capture it in a new immutable Mock snapshot, and exercise the canonical fallback command before Real. Synthetic evaluator and generic canonical integration tests passed; actual production fallback acceptance remains unverified. Deferred A-Day production command acceptance is also open.

### Remaining acceptance gates

Before September 30: finish deferred A-Day production UI acceptance, reconcile the missing approved Firefighter assignment-to-Bid bindings and verify the actual Investigator fallback command in a new isolated Mock, repair and validate the GitHub Cloudflare credential, reconcile D102-D104 term evidence, complete authenticated staging acceptance if approved access is available, and maintain the visual guides and their per-capture provenance. The one-time exact-cutoff continuation is scheduled for **2026-09-30 17:00 America/New_York**; the 21:00 daily continuation remains backup verification.

At or after the cutoff: seal and verify approved source/personnel/credential evidence and intervening-write log; save the final immutable version and read back its hash; run a new final Mock and reconcile the actual awards, placements, audit and PDFs; repeat Managed Live readiness and refresh the final manuals. Only these post-cutoff steps can certify final evidence. The Real Bid remains unstarted and requires separate operational authorization.
