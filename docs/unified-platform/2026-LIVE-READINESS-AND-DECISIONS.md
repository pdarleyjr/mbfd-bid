# 2026 Bid live readiness and decisions

Last evidence review: 2026-09-27. **NOT READY** for final configuration or Real Bid start. This is the current decision register; `2026-final-bid-reconciliation-gate-20260926.md` is a historical candidate report. No version, Mock, deployment, or live acceptance is established by this document.

## Source hierarchy and exact artifacts

The final July 2026 Bid Policy controls Bid rules. The final MASTER controls 2026 organizational seat identity and rank. The 2026 Shift Template and calculation workbook corroborate or expose source differences; older diagrams and assignment exports describe historical/current staffing, not an approved correction to a final Bid seat. No numeric position ID or arithmetic balance alone changes role identity.

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
| B | 7 | 12 | 54 | 73 |
| C | 7 | 12 | 54 | 73 |
| Days | 2 | 2 | 0 | 4 |
| Candidate total | 23 | 38 | 162 | 223 |
| Reviewed bidder cohort | 22 | 39 | 161 | 222 |

**Blocking contradiction:** 39 Lieutenant bidders have only 38 Lieutenant opportunities. B703 is `Firefighter #1` in final MASTER Positions row 134 and in the supplied 2026 Shift Template. The 2025 B-shift diagram and current assignment evidence show a third B Rescue Float Lieutenant. If B703 were changed to Lieutenant, arithmetic would become 23/39/161 with one Captain vacancy, but the supplied final 2026 topology does not approve that change. The candidate retains B703 as Firefighter. The successor builder now fails closed on rank shortage. The exact missing authoritative fact is an approved 2026 position correction identifying a Lieutenant opportunity, or an approved participant-cohort/rank correction that removes the shortage. No final rank-total regression assertion may be substituted for that fact.

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

The candidate now resolves employee `18148` by stable employee identity with a unique-match guard. Position remapping touches schema-declared references and leaves narrative/source text intact. These changes are in the PR worktree and have not been merged or deployed. The unused zero-holder `NFPA 1123` duplicate is still to be retired through the audited catalog workflow, with a receipt preserved. Operator authority and Real-only settings require versioned UI/review proof.

The approved evidence cutoff is **2026-09-30 17:00 America/New_York**, equal to `2026-09-30T17:00:00-04:00`. It is later than this review. Current date-only evidence projection cannot prove that a same-day change was accepted by 17:00; the final immutable evidence snapshot/import identities, hashes, approval time, and exclusion of later same-day writes remain a release gate. The 2026-09-30 calendar date is an evaluation date, not a substitute for the instant cutoff.

Local lint, typecheck, production build, focused regression tests, all 786 web tests, and all 25 Worker launcher tests passed on this candidate. The broad Worker run had 2,688 passing tests and one Station 6 test timeout under full-suite load; that file passed all 38 tests on a single-file rerun. Hosted CI on PR #200 commit `ffeec1118881d5883b4987b9b0e163d989765f84` passed Lint + Typecheck, Unit + Integration, and Playwright E2E in [CI run 36348894595](https://github.com/pdarleyjr/mbfd-bid/actions/runs/36348894595); JavaScript/TypeScript analysis and CodeQL passed in [CodeQL run 36348894594](https://github.com/pdarleyjr/mbfd-bid/actions/runs/36348894594). This hosted receipt supersedes the local timeout for candidate CI, but it is not a Mock or production acceptance receipt.

Authenticated production catalog review on 2026-09-27 displayed `NFPA 1123` with zero referenced members. The audited retirement was not completed; no catalog mutation receipt exists. Pre-cutoff end-to-end Mock, final post-cutoff evidence freeze, final immutable version, final acceptance Mock, merge, staging, backup, production deployment, authenticated acceptance, and visual manuals have no completed receipt in this register. Portal/staffing writeback must remain disabled in any rehearsal. The Real Bid has not been authorized to start.

**Next decision:** identify the approved 2026 rank/seat or participant correction from an authoritative source. Then rerun rank totals and the full source/rule audit, implement the exact cutoff evidence freeze, and continue the authorized rehearsal and release gates in sequence.
