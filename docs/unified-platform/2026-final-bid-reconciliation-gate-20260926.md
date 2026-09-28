# 2026 final Bid source and production gate — updated 2026-09-27

Status: **corrected source candidate and successor transformation validate locally; immutable production successor and fresh Mock remain pending**. This is source evidence and a dry-run validation, not a saved Bid definition, deployment, or Mock acceptance.

The supplied MASTER workbook (SHA-256 `0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a`) has 228 organizational rows: A 74, B 73, C 73, Days 8. The three A/B/C 211 Division Chiefs cannot be Bid opportunities. A801 Union President is an organizational position excluded from shift count. D201/D301/D401/D402 are closed this cycle under the July policy. Thus the raw source gives 72 ordinary non-Chief positions on each shift and four Days opportunities: 220 provisional opportunities total. This **audit count is not an application topology constant**.

## Missing role determination

The administrator's direct review of the actual 2025 A/B/C shift diagrams confirms each shows 74 counted positions including one Division Chief and a counted `Captain #1 (C)` under **Station #2 / Float 2**. A-shift Union President A701 appears separately outside the counted blocks. The diagrams were independently inspected on 2026-09-27; they are historical structure evidence, subordinate to the final 2026 MASTER for individual seat rank. Independent available evidence agrees:

- Legacy `2026_positions.json` has A213/B213/C213 as floating CPT `Captain #1 (C)` roles, one per shift. Those numeric IDs now identify Rescue Float Lieutenants in the final source, so copying the legacy IDs would corrupt the final topology.
- `Daily Shift Staffing Guidelines 1.13 12-1-25.docx`, supplied extraction SHA-256 `c13364c0ea9333383b70e3c8578640fc097a2af4dddfde863170383db1328659`, explicitly refers to `Bid Floating Captain with Certs` for Marine coverage and the second boat.
- Final July policy (SHA-256 `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc`) Procedure 11 establishes Combat and Rescue Float Pools. It does not abolish the floating Captain role. The final MASTER omits any floating CPT profile.

Together, these establish the carried-forward **Station #2 / Float 2 / Combat-track Floating Captain** business role with one counted seat per A/B/C shift. Procedure 11 excepts Special Ops Floats from ordinary Combat and Rescue Float Pools. The `(C)` label identifies the Combat track; it does not move the seat out of Station #2. Procedure 7 therefore gives this seat the Station #2 Special Operations preference calculation. The guideline's `with Certs` applies to Marine coverage. It does not by itself make obsolete Marine certificates a Bid minimum for this Captain.

`A718/B718/C718` are collision-free in both the 228-row MASTER extraction and the historical 242-row template. They are **new application canonical identities** for Station #2 / Float 2 seats; their numeric range does not determine placement. They do not pretend to be workbook row IDs. The corrected candidate topology contains 231 organizational rows and exactly 73 biddable non-Chief positions on each shift, plus four biddable Days positions. The immutable MASTER fixture and historical versions remain unchanged.

## Union President and other protected positions

The legacy 2026 template's A701 Union President is marked `isExcludedFromCount: true`; an older narrative position template calls the same excluded organizational role A711. The older `2026_Bid_Process.md` even labels A711 as “1 pick” while marking it excluded from count. That wording is contradictory historical design evidence, not a final July policy change or an authority to use Union President as the missing ordinary capacity seat. The final MASTER's A801 row is also count-excluded. The administrator states the historical A-shift diagram shows Union President outside the 74 counted shift positions. No final July policy provision was found making Union President an ordinary Bid seat. A801 remains organizational/protected and is not used to reach 73. The managed-run inventory now rejects A801 or any closed Days row marked BIDDABLE even when its count flag hides the row. A211/B211/C211 remain non-biddable regardless of count flags.

## Runtime boundary and unfinished gates

Read-only production evidence from 2026-09-26: immutable Bid version 8, SHA-256 `74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666`, contains 228 positions, 223 rules and 228 participation rows. Its reported 73/73/73 biddable count includes a Chief on every shift; the actual non-Chief count is 72/72/72. Version 8 is not corrected, and no Real session was found in the read-only session query. The query reported `changed_db=false`.

The corrected topology and the role-derived 223-rule set are **draft source candidates only**. `2026-corrected-semantic-roles.json` classifies every one of the 231 organizational profiles by current role; `2026-corrected-draft-rule-audit.json` records all 223 candidate rules and the explicit technical blockers. The draft does not inherit any same-number legacy rule. A pure successor builder remaps the immutable version 8 policy by reviewed business role: 109 old IDs are absent from the corrected namespace and 18 reused IDs describe different roles. It regenerates the 223 biddable seats, five stage scopes, source scopes and 2026 participant lists while retaining the eight verified Days staffing bindings. Its local canonical dry run used the administrator's **2026-09-30 eligibility date** and **2026-10-24 Bid start date**; it returned 231 positions, 223 valid rules, A/B/C 73 each, Days 4, no biddable Chief, no retired exact-ID references, and no Special Ops or Marine seats in ordinary Float pools. The dry run did not save a version. The administrator set the exact eligibility cutoff to **2026-09-30 17:00 America/New_York** (`2026-09-30T17:00:00-04:00`). The initial credential source date remains separate provenance.

The current settings and qualification/personnel projections evaluate calendar dates. They cannot prove which same-day evidence existed at 17:00. The corrected successor therefore records this as an OPEN **final-configuration** source gate. After the cutoff, reconcile the final credential and personnel source snapshot and any September 30 events by timestamp before resolving the gate or saving the immutable version. An earlier date-only dry run does not satisfy that gate.

The final calculation workbook's `Rules & Points` sheet helps identify legacy
scoring families but conflicts with the governing policy in material places:
Captain 5 rows omit the 36-month Rescue and Paramedic minimums; Air Tech rows
require car-seat certification although policy treats it as preferred; and
Investigator rows award points for the minimum certificates while omitting
the IAAI-CFI preferred tier. The draft follows the July policy for those
known conflicts, but production validation remains open. The reviewed
reconciliation binds nine policy terms to live existing catalog identities:
IAAI-CFI, NFPA1123, NFPA1126, RN8312, RN8313, RN8977 I/II, and issuer-specific
DRI/PADI Public Safety Diver. The two genuinely missing definitions, **Valid
OUPV / Six Pack Authority** and **Passing IADRS Watermanship Test**, were created
through the audited production catalog on 2026-09-27 with default points zero
and zero holders. No member qualification was assigned. A redundant `NFPA 1123`
definition was also created before the existing `NFPA1123 Outdoor Fireworks`
identity was identified; it has zero holders, no policy dependencies, and must
be retired through the audited catalog workflow. The initial credential sheet contains
one IAAI-CFI record,
43 generic MMC records, and 53 generic IADRS Swim Evaluation records; those
aggregate counts do not prove OUPV endorsement, passing watermanship,
certificate validity, or DRI/PADI issuer. The successor resolves seven catalog
identity source decisions and the Investigator preference ordering, while 25
OPEN source decisions remain scoped to Real activation and person-specific or
operational evidence, in addition to the one final-configuration cutoff gate.
Marine open-water-only entry without DRI or PADI PSD carries a DRI due date of
2027-01-24, three calendar months from the approved 2026-10-24 Bid start under
Procedure 8(f)(i). PADI PSD entry without DRI carries a separate continuing
education/training/renewal transition with no fabricated fixed deadline under
Procedure 8(f)(ii). None
of these gaps calls for an administrator to choose an internal position ID.

## Superseding candidate finding

**RESOLVED 2026-09-27:** The administrator explicitly approved the B703-B706 application correction from the reviewed source package. The current decision, raw-vs-corrected audit, and 23/39/161 rank reconciliation are in `2026-LIVE-READINESS-AND-DECISIONS.md` and `2026-rank-capacity-candidate.json`. The following paragraph is retained as historical evidence of the earlier unresolved state.

The live release decision is now tracked in
`2026-LIVE-READINESS-AND-DECISIONS.md`. That register supersedes this
2026-09-26 candidate summary wherever newer source reconciliation or code
validation differs. In particular, the final MASTER and supplied 2026 shift
template label B703 as Firefighter; a 2025 B-shift diagram and current
assignment export show a third B Rescue Float Lieutenant. Assignment evidence
does not approve a 2026 Bid rank correction. The resulting 39 Lieutenant
bidders versus 38 Lieutenant opportunities is a hard final-configuration gate.
