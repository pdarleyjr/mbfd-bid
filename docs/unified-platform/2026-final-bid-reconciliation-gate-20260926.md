# 2026 final Bid reconciliation gate — 2026-09-26

Status: **blocked on approved position topology**. This is source and runtime
evidence, not a new Bid definition, production deployment, or Mock acceptance.

The administrator identified `C:\Users\Peter Darley\Downloads\OneDrive_2026-09-19\Bid App folder`
as the source folder. It contains the final MASTER workbook, annual calculations
workbook, July policy PDF, and August assignment export. No corrected position
file or named additional seat was present there at this review.

The MASTER `Positions` and `Bid A/B/C` sheets agree on A 74, B 73, C 73, and
Days 8 profile IDs. A211/B211/C211 are Division Chief assignments. A801 is a
Union President organizational profile. Removing the three protected Chiefs,
A801, and four closed Days profiles leaves 72 ordinary Bid candidates on each
shift and four Days candidates. The `Max Shift Count: 73` entries do not name
an additional position. The annual calculations workbook supplies aggregate
counts, and the assignment export records occupancy; neither establishes the
missing Bid position identities. The source manifest and legacy-rule audit are
in `2026-source-opportunity-audit.json` and
`2026-legacy-rule-semantic-audit.json`.

Read-only production D1 query on 2026-09-26: immutable Bid definition version
8, SHA-256 `74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666`,
contains 228 positions, 223 rules, and 228 participation rows. Its biddable
count is 73/73/73 only with one Division Chief on each shift; excluding Chiefs
gives 72/72/72. The query reported zero changed rows and `changed_db=false`.
Version 7 remains present. A separate read-only session query found only Mock
sessions for 2026, with no Real session in the queried table.

To complete a corrected successor without inventing positions, obtain the
approved exact Bid position IDs, shift, station/unit, role and Bid rank for the
missing seat on each shift, or an approved corrected workbook with those rows.
The authority must also settle whether A801 is an ordinary biddable opportunity;
its current organizational label does not establish that. Then reauthor and
review the rule book by semantic role, save a new immutable version, run a fresh
Mock and acceptance, and create visual manuals from the deployed interface.
Historical versions and Mock sessions remain untouched.
