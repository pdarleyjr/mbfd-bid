# 2026 Lieutenant count reassessment — October 1, 2026

The earlier statement that the department is actually one Lieutenant short was not established by the evidence. It compared listed bidders with open bid opportunities without resolving closed-position and participation scope. That arithmetic difference is a reconciliation question, not a confirmed staffing shortage.

The unchanged MASTER V4 source SHA-256 is `a1bc6309bd7f565b98616226fd3cbe5fae6c6d7ce764188bdbfdd1eb8702e685`. Its Positions sheet contains 40 raw Lieutenant roles. The reviewed application topology includes the administrator-approved B703 Lieutenant correction, producing 41 total Lieutenant positions. D401 and D402 are closed Training positions under July policy Procedure 4; 39 Lieutenant opportunities are open for selection. No physical position is missing merely because the open count is 39.

The Annual v5 `SeniorityRD!L7` formula `COUNTIF(E$2:E$994,"Lieutenant")` counts 40 listed Lieutenant ranks. It does not filter current participation, incumbent retention, closed assignments, or effective dates. `K7` is a separate hardcoded planning number (36). `Sheet5!B17:D17` contains separate planning counts of 41 total, 37 shift, and 4 Days Lieutenants. These measures cannot be substituted for one another.

The newly supplied Annual v5 workbook SHA-256 is `9518fe83c229fe7bd3a9adb1a8a28da9e7c8d989de9a8a83eebea61e5ca2995c`. A read-only comparison with the sealed source preserved in the supplied ZIP found the same 49 sheets and no cell value/cache, formula text, formula attribute, or raw cell-type differences. XML metadata, styles, and pivot serialization changed on save; this comparison does not claim Excel recalculation.

Two additional spreadsheet traps were verified: `D Shift - Bid!E8` counts `B4:B6`, excluding the fourth Days position in B7; the Positions autofilter ends at row 228, excluding the final D402 row 229. Statistics also contains obsolete references and `#REF!` formulas. Annual Bid RD's current assignment columns U:Z belong to the hardcoded current-name column T, not automatically to the new-bid employee in B or L:Q. Joining those assignments to B would misidentify people.

Current rank evidence remains unchanged: Mederos (17836) is Lieutenant in SeniorityRD and the reviewed MASTER despite an older Firefighter row in TeleStaffRD; Sica (18435) is Firefighter in the reviewed source. No member may be excluded or re-ranked just to balance counts. Historical 2025 positions alone do not prove a current retained assignment.

Version 11, its source decisions, and Peter's personal Mock remain immutable. The operator summary now describes the 40-listed / 39-open difference as count reconciliation. An exact current participation or retained-assignment explanation must be supported before changing a Real activation decision; this reassessment does not create or start a Real bid.
