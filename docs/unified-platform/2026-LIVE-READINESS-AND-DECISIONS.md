# 2026 Bid live readiness and decisions

Last release review: 2026-09-28 00:26 Eastern. **NOT READY** for final evidence certification or Real Bid start. The corrected application is merged and deployed; the September 30 cutoff and final Mock remain open. This is the current decision register; `2026-final-bid-reconciliation-gate-20260926.md` is a historical candidate report. A local, production-shaped pre-cutoff Mock is complete and recorded in `2026-precutoff-rehearsal-evidence-20260927.md`. It is not the final evidence-certified Mock.

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

PR #200 final head `e28966bb75b133584c4a41a37545e312f95e5721` passed all five hosted checks and merged by squash to main `bf7b59979cffbf0777dfacad437c21aee2b20895` on 2026-09-27 at 23:34 Eastern. The merged main CI passed. Earlier local validation passed lint, typecheck, the isolated production build, and the full package suites: Eligibility 135 passing/1 skipped, Shared 186 passing, A-Day 73 passing, Worker 2,702 passing/20 skipped plus 25 Wrangler launcher tests, and Web 793 passing. The browser suite had 139 passing, 14 intentional skips, and one timing-sensitive simulated reconnect test failure; after separating the synthetic offline/online events, that test passed on desktop and mobile. The separate large-impact browser suite passed all 14 tests.

The automatic staging workflow failed before deployment because the repository Cloudflare API token was rejected. A controlled direct Wrangler release of that exact merged source deployed staging Worker `a558fc9b-51be-4a06-9a74-ff7533493c54` and staging Web `d2a985e1-3bf5-4042-b6ff-7e3346d5145c`. Health and Hub login redirect were observed. Authenticated staging acceptance is pending a valid approved staging sign-in; a saved staging credential was rejected once and was not retried.

A fresh production D1 export was uploaded to R2, downloaded, hash-checked, restored locally and rehearsed with migration 0069; table counts, `quick_check` and foreign keys reconciled. Production migration 0069 then passed ledger, `quick_check`, foreign-key and protected-row-count checks. Direct Wrangler deployment of the same merged source produced Worker `99ee8487-99d0-466f-87f8-8aeedce176e0` and Web `2d3d7709-9429-422b-8a58-f6abab5596b3`. Authenticated production sign-in and Current Bid, Mock readiness, Marine evidence, Results, version history and Managed Live preflight were exercised. Version 9 was saved from the reviewed pre-cutoff candidate, read back as ID `01M3K2YJFQ46Y8BZ5PH3GQKCQ0` with SHA-256 `afc40fb96c566d104a53f2cb34d9ee6d40d5217e9de21e71f61a9f3ea2b6cbc3`. It is not the final post-cutoff version. The Live preflight correctly blocks on D102-D104 reviewed assignment terms and created no Real session. Portal/staffing writeback remains disabled.

The pre-cutoff local Mock completed 256 canonical command events and 201 awards from corrected rehearsal version `01M3JQQZBG0HB62DG2HAQCH0BR` (SHA-256 `afc40fb96c566d104a53f2cb34d9ee6d40d5217e9de21e71f61a9f3ea2b6cbc3`). The 21 members without awards and 22 unfilled seats include one planned excess Captain opportunity and additional source-limited specialty vacancies; this rehearsal cannot certify the final one-vacancy outcome. See the separate evidence report for exact counts, executed scenarios, defects, and export hashes. The final post-cutoff evidence freeze, final immutable version, final acceptance Mock, full Live readiness, authenticated staging acceptance, and visual manuals remain open. Portal/staffing writeback stayed disabled in rehearsal. The Real Bid has not been authorized to start.

**Next work:** complete staging authentication and the visual operator guides, capture the actual September 30 cutoff evidence, create the final immutable version, run a separate final Mock and repeat the server Live preflight. The final September 30 evidence decision remains OPEN until the actual cutoff snapshot is verified.
