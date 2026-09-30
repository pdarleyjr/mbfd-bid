# September 30 latest-source reconciliation

This is a pre-cutoff source and implementation report. It is **not final production acceptance**, an evidence freeze, or permission to start Real. Version 9 remains historical and unchanged. The [machine-generated delta report](2026-latest-source-delta-20260930.json) records exact source hashes and independently derived counts. Detailed employee/credential comparisons are retained privately with the immutable extracted sources.

## Verified sources

The September 29 ZIP has SHA-256 `5c9c2424801a88c080621ea6fc836e9b454cf449a9b58aac30c7d9efd07a0f3c`. Its July policy is byte-for-byte equal to the prior supplied policy, with actual hash `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc`; the expected policy hash in the request does not match these actual bytes. The August 24 assignment export is unchanged and supplies no new September assignment observation. MASTER V2 and V3 Positions are logically identical across 228 source rows.

MASTER V3 and Annual v5 Seniority RD agree on Matthew Fisikelli as Captain, Aurelio Mederos as Lieutenant, and Dwight Nicholas as Division Chief. They do not supply historical promotion dates for these changes. Use a source-observation **CORRECTION**, recording the original hashes and explicit Bid-pool decision, without changing assignments or inventing a promotion date. The supplied directory was modified September 23 and retains older ranks/assignments; it is not independent evidence against the newer substantive ranks.

Five removed employees agree with previous departure instructions. Hans Estrada's existing departure exclusion must survive the newer workbook's Include flag. Firefighter DE remains Firefighter rank; DE qualification must come from independent qualification evidence. The independent candidate population is **22 Captains, 40 Lieutenants, 160 Firefighters, 222 total**, including the previously approved Jeremy Bloomfield Captain treatment and excluding Adonis Garcia.

## Topology decision still required

Retain reviewed Float Captains A718/B718/C718 and the reviewed B703 third Rescue Float Lieutenant until stronger evidence supersedes them. Existing reviewed opportunities are **23 CPT / 39 LT / 161 FF**, A/B/C 73 each, Days 4, total 223. These are reviewed existing capacities, not a claim that latest-source rank capacity is resolved.

The source introduces one more Lieutenant than available Lieutenant opportunities. MASTER V3 and the September 4 C roster show two C Float Lieutenants; the accepted older assignment/directory places Mederos in a third C Float Lieutenant slot. An administrator must provide the approved seat/rank change or an explicit business participation decision. Do not exclude someone or convert a seat solely to balance counts. A new pre-cutoff Mock can carry this as an explicit Real-activation blocker and expose the simulated shortfall.

## Credential reconciliation and implementation

The importer now discovers numbered credential sheets and sorts revisions numerically. Operators see and choose a revision; the latest available revision is visibly offered. Multi-revision callers cannot silently fall back to Version 1. Start and Expiration dates are read by header name. The saved receipt retains original workbook SHA-256, selected sheet/revision, row/employee counts, filename, server observation time, and last approved application time; final evidence capture retains the original workbook hash and selected revision.

Version 4 contains **3,884 rows, 230 employees, 65 credential names**. V1→V2 changes 19 keys/12 people; V2→V3 changes 3 keys/2 people; V3→V4 changes 22 keys/18 people. Overall V1→V4 changes **43 keys/30 people**: 22 additions, 12 updates, 9 omissions. Omissions are not automatic revocations. Production comparison also identifies thousands of missing dates from older active-only imports; source delta and production reconciliation are different measures.

An active-only report proves presence at its observation date, not its issue date. Immutable original rows identify inferred observation dates. New dated evidence can fill missing facts while preserving historical observations; an explicitly conflicting issue date still requires individual review. Positive and expired corrections take effect when the newer dated report is observed, while retaining the source's actual issue/expiration dates.

Contiguous future renewals are retained in the existing effective-dated ledger. Tests verify Nodarse's EMT Basic and Taj Thomas's Paramedic remain valid September 30 under their current intervals and move to the December 1 renewal on its effective date; retries create one event. Production needs an explicit EMT Basic catalog mapping and the two older current intervals before approving the V4 future rows. Use the original earlier revision explicitly for those interval facts; never silently replace the selected V4 source.

David Sola's PSD expiration `2099-05-07` remains an anomalous source value requiring individual verification. Blanket adverse approval cannot accept it. Brian Galletta's PSD start `2029-06-25` also needs verification and a dated current interval; production currently supplies neither an issue date nor an expiration. These facts are preserved, not corrected by assumption.

## Specific remaining evidence and execution

- Fire Investigator A/B/C: current approved assignee-to-seat bindings. Older worksheet clues are Michelle Viera/Henson, Claudio Navas, and Michael Sica. Accepted production assignments instead show Henson on A Ladder 3, Navas in Days Training, and Sica in Days Training. Qualifications alone do not prove assignments.
- D102–D104: reviewed appointment/term-start dates and current assignees. Production has no accepted tenure evidence. These remain Real-only evidence requirements and must not block Mock rehearsal.
- Production authentication: a legitimate administrator browser session is needed for the audited imports, corrections, new immutable version and Mock commands. Do not forge production tokens or bypass PIN/Hub authentication.
- After deployment and source approval: regenerate every eligible list and specialty order through the canonical evaluator, compare against Version 9, save/read back the new pre-cutoff version and hash, and create/start a separate Mock with red MOCK indication and writeback off.
- At or after **2026-09-30 17:00 America/New_York**: verify relevant intervening writes and exact accepted sources, seal evidence, save/read back the final immutable version, run a new complete Mock and reconcile exports, then rerun Managed Live readiness and update the year-specific guide. Existing cutoff and continuation automations now target this latest-source chat.

The scheduled capture now refuses Version 9 or an older/unreviewed credential source. It requires the newer source decision with both original file hashes, the three corrected production rank/pool records, and recorded approval/rejection outcomes for all 3,884 rows of the original Version 4 workbook. Individual rejected values remain preserved as source evidence and retain their explicit Real-only decision; they are not converted into approved qualification facts.

Real Bid: **NOT STARTED**. No production data update, final freeze, or new production Mock is claimed by this implementation report.

## September 30 MASTER V4 supersession

Independently verified at 2026-09-30T17:05:43.389868+00:00: MASTER V4 SHA-256 `a1bc6309bd7f565b98616226fd3cbe5fae6c6d7ce764188bdbfdd1eb8702e685` supersedes V3 `3631427507fa7ca0280a03e9b0a14a2429bbafad3404d46f5cef4a1ce679b57d`. Original workbooks are unchanged and V3 history is retained. The complete cell comparison found exactly 25 Personnel `AO` corrections from derived Firefighter DE to Firefighter while preserving the source job, plus 34 Float lookup formulas on each A/B/C Bid sheet (102 total, AN/AO now use AK position IDs). Positions, Template, all A-Day sheets, Days Bid, Bid Pick, A Days, Tables, Manual and Test Data have no cell changes. The existing reviewed 73/73/73 plus four Days opportunities remain governing.

All 25 FF-DE members were mechanically checked; this corroborates the existing semantic FF rank rule, without member-specific code. V4 includes 22 Captains, 40 Lieutenants and 161 Firefighters; Hans's existing administrator exclusion gives 22/40/160, 222 participants. V4 adds no Lieutenant opportunity: 40 bidders/39 opportunities remains a visible Real-only blocker for today's rehearsal.

Remaining formula references containing `#REF!` are unchanged: A A-Day 3, B A-Day 1, C A-Day 3, Statistics 36, Bid Pick 222. The workbook is not formula-clean; reviewed policy and business facts drive the application, and Excel errors/formulas are not imported into the engine. Annual v5 and its original Credential V4 sheet remain the credential source; completed approvals are retained.

The final cutoff guard now rejects V3-only source acceptance and requires accepted MASTER V4 plus Annual v5, corrected personnel and complete credential review. It still refuses Version 9 and incomplete receipts. Final capture must use V4 at or after 17:00 Eastern; no early freeze is authorized.
