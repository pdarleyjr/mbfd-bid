# 2026 final Bid source and production gate — updated 2026-09-27

Status: **corrected position role identified; corrected rule book and production successor still pending**. This is source evidence, not a saved Bid definition, deployment, or Mock acceptance.

The supplied MASTER workbook (SHA-256 `0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a`) has 228 organizational rows: A 74, B 73, C 73, Days 8. The three A/B/C 211 Division Chiefs cannot be Bid opportunities. A801 Union President is an organizational position excluded from shift count. D201/D301/D401/D402 are closed this cycle under the July policy. Thus the raw source gives 72 ordinary non-Chief positions on each shift and four Days opportunities: 220 provisional opportunities total. This **audit count is not an application topology constant**.

## Missing role determination

The administrator supplied the description of the 2025 A/B/C shift diagrams: each shows 74 counted positions including one Division Chief and a counted floating `Captain #1 (C)`. The diagram image files were not available for direct inspection in the accessible source locations during this pass, so this claim is attributed to the administrator rather than independently verified. Independent available evidence agrees:

- Legacy `2026_positions.json` has A213/B213/C213 as floating CPT `Captain #1 (C)` roles, one per shift. Those numeric IDs now identify Rescue Float Lieutenants in the final source, so copying the legacy IDs would corrupt the final topology.
- `Daily Shift Staffing Guidelines 1.13 12-1-25.docx`, supplied extraction SHA-256 `c13364c0ea9333383b70e3c8578640fc097a2af4dddfde863170383db1328659`, explicitly refers to `Bid Floating Captain with Certs` for Marine coverage and the second boat.
- Final July policy (SHA-256 `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc`) Procedure 11 establishes Combat and Rescue Float Pools. It does not abolish the floating Captain role. The final MASTER omits any floating CPT profile.

Together, these establish the carried-forward **Combat Floating Captain** business role with one counted seat per A/B/C shift. The old template groups `Captain #1 (C)` at Station #2 / Rescue / Float 2, while its `(C)` label and the July pool policy point to Combat Float Pool. This source-label conflict is recorded; the corrected application placement uses Combat Float Pool. The guideline's `with Certs` applies to Marine coverage. It does not by itself make Marine certificates a minimum for the ordinary floating Captain Bid seat.

`A718/B718/C718` are collision-free in both the 228-row MASTER extraction and the historical 242-row template, and continue the final Combat Float Pool identity range A/B/C707–717. They are **new application canonical identities**; they do not pretend to be workbook row IDs. The corrected candidate topology contains 231 organizational rows and exactly 73 biddable non-Chief positions on each shift, plus four biddable Days positions. The immutable MASTER fixture and historical versions remain unchanged.

## Union President and other protected positions

The legacy 2026 template's A701 Union President is marked `isExcludedFromCount: true`; the final MASTER moves that organizational role to A801 and also marks it excluded. The administrator states the historical A-shift diagram shows Union President outside the 74 counted shift positions. No final July policy provision was found making Union President an ordinary Bid seat. A801 remains organizational/protected and is not used to reach 73. The managed-run inventory now rejects A801 or any closed Days row marked BIDDABLE even when its count flag hides the row. A211/B211/C211 remain non-biddable regardless of count flags.

## Runtime boundary and unfinished gates

Read-only production evidence from 2026-09-26: immutable Bid version 8, SHA-256 `74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666`, contains 228 positions, 223 rules and 228 participation rows. Its reported 73/73/73 biddable count includes a Chief on every shift; the actual non-Chief count is 72/72/72. Version 8 is not corrected, and no Real session was found in the read-only session query. The query reported `changed_db=false`.

The corrected topology and the role-derived 223-rule set are **draft source candidates only**. `2026-corrected-semantic-roles.json` classifies every one of the 231 organizational profiles by current role; `2026-corrected-draft-rule-audit.json` records all 223 candidate rules and the explicit technical blockers. The draft does not inherit any same-number legacy rule. It is intentionally disconnected from production save paths while exact credential, service, scoring, preference, post-award, priority and A-Day evidence is reconciled. No production mutation, Real Bid, portal writeback, or staffing writeback is authorized by this record.

The final calculation workbook's `Rules & Points` sheet helps identify legacy
scoring families but conflicts with the governing policy in material places:
Captain 5 rows omit the 36-month Rescue and Paramedic minimums; Air Tech rows
require car-seat certification although policy treats it as preferred; and
Investigator rows award points for the minimum certificates while omitting
the IAAI-CFI preferred tier. The draft follows the July policy for those
known conflicts, but production validation remains open. Its current reference
catalog lacks seven named policy/source credentials: IAAI-CFI, NFPA 1123,
NFPA 1126, RN 8312, RN 8313, and both RN8977 course parts. The initial
credential sheet contains one IAAI-CFI record, 43 MMC records, and 53 IADRS
Swim Evaluation records; those aggregate counts do not prove OUPV endorsement,
passing watermanship, certificate validity, or DRI/PADI issuer. Marine DRI
completion is due three months from the approved Bid start date under policy
Procedure 8(f), which has not been configured. None of these gaps calls for an
administrator to choose an internal position ID.
