# Final 2026 position, personnel, and eligibility audit

Date: 2026-09-24. This record distinguishes locally verified implementation
facts from deployment and authenticated acceptance gates. It is not evidence
that a Real Bid was started.

## Governing sources

| Source | Immutable identity / applied authority |
| --- | --- |
| Final July 2026 Bid Policy | SHA-256 `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc`; governs eligibility and Bid procedure. |
| `MASTER 2026 Bid Positions Selection V2.xlsx` | SHA-256 `0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a`; `Positions` is the final 228-profile topology. |
| `2026 Annual Bid Calculations v3.xlsx` | The exact `2026_BID_Credentials_Version_1_` sheet is the initial credential baseline. Credential and personnel evaluation date: 2026-09-24. |
| TeleStaff assignments | The accepted 2026-08-28 baseline remains assignment authority until a newer import is reviewed and approved. |
| 2026-09-24 administrative decisions | Resolve final-source interpretation, six departed employees, Bloomfield's Bid rank, HMO-to-HMA equivalency, SWAT identities/constraints, and operator-configurable settings. |

The checked-in 242-position v1 topology remains readable historical data. It is
not the final 2026 candidate and does not impose a source-number-equality gate.

## Reconciled final facts

- Source topology: 228 profiles — A 74, B 73, C 73, D 8.
- Active 2026 opportunities/rules: 223 — A 73, B 73, C 73, D 4.
- A801 Union President is preserved but is not an ordinary Bid opportunity.
- D201, D301, D401, and D402 are preserved closed source profiles and cannot be
  awarded in the 2026 Bid.
- B214 and C214 use Combat at runtime. Their raw Rescue source label remains in
  immutable provenance with the approved correction.
- Ordinary active cohort: 221 — 21 Captain, 39 Lieutenant, 161 Firefighter.
- Division Chiefs are not ordinary rank-stage bidders.
- Employee IDs 16584, 16613, 16617, 16573, 19131, and 20734 are explicitly
  excluded. Stale roster absence does not exclude anyone else.
- On 2026-09-25, employee ID 18148 (Dwight Nicholas) was confirmed as the
  current B-shift Division Chief occupying protected position B211. His stored
  Captain rank remains identity evidence, but he is excluded from ordinary
  Captain stages while occupying that administrative assignment.
- Employee ID 18158 uses Captain for this Bid; the acting Division Chief
  assignment remains separately preserved evidence.
- Captain and Lieutenant ordering uses reviewed time-in-grade Bid ordinals.
  Firefighter ordering uses reviewed department-service Bid ordinals. Missing
  evidence or an unresolved exact tie fails closed; employee ID and alphabetic
  order are not fallback tie-breakers.

## Credential decisions

- Start after 2026-09-24 is not yet effective.
- Expiration before 2026-09-24 is expired; expiration equal to 2026-09-24 is
  valid; blank expiration is valid unless explicit revocation/removal evidence
  exists.
- Omission from a later import never removes prior evidence. Imports are
  append-only and require Upload, Parse, Compare, Review, Approve, and Commit.
- Current HazMat Operations satisfies a Haz-Mat Awareness minimum through the
  approved one-way 2026 equivalency. The source HMO credential is retained and
  the explanation records why it satisfied HMA. No reverse or unrelated
  equivalency is inferred.
- A newer approved TeleStaff credential import deterministically supersedes the
  older current view without rewriting credential history.

## Specialty and A-Day execution

- The useful five-stage model remains: Days/Specialized Captains,
  Days/Specialized Lieutenants, Captains, Lieutenants, Firefighters.
- Specialty eligibility is rule-based, not inferred from current D assignment.
  A specialty candidate remains in the ordinary rank sequence.
- An early specialty winner cannot select a second position. Their A-Day is
  deferred to the visible, audited ordinary rank turn, after which execution
  advances normally. Decline/failure continues to the ordinary position and
  A-Day turn.
- The six SWAT identities are 18366, 16563, 20730, 19953, 24506, and 20745.
  The resulting assignment must have exactly two on each of A/B/C and the pair
  on one shift must use different A-Day groups.
- No general or Captain/DC A-Day cap is invented. Explicit Marine, SWAT, DE,
  and policy-backed constraints remain enforceable; the four final-source
  groups are used.

## Operational configuration defaults

- Credential and personnel evaluation dates: 2026-09-24.
- Assignment baseline: accepted 2026-08-28 until a newer approved baseline.
- Expected duration: 3 days. Turn timer: 300 seconds.
- Contact handling: operator discretion with no fabricated numeric minimum;
  UNREACHABLE still requires explicit audited operator action and reason.
- Staffing/transition effective date is a specific administrator confirmation
  required before Live, never an invented date.
- No additional unpublished Chief supplement is assumed. A later official
  supplement can be added by an authorized administrator before Live.
- Backup AirTech is fallback/qualification behavior for the real AirTech
  opportunity, not an invented topology seat.

## Gate status

| Gate | Status | Evidence / next boundary |
| --- | --- | --- |
| Source package | Locally verified | Hash-locked deterministic extraction reproduces 228/223 and preserves raw correction provenance. |
| Positions | Locally verified | Final topology and five non-biddable preserved profiles are asserted in source and tests. |
| Participants | Locally verified | Explicit exclusions, Bloomfield override, DC separation, and 22/39/161 cohort invariants are centralized and tested. |
| Seniority/order | Locally verified | Reviewed ordinal channels are required; ID/alpha fallback is rejected. Production evidence still must be previewed from the saved successor. |
| Credentials | Locally verified | Exact-sheet XLSX parsing, lifecycle semantics, append-only import handling, and HMO-to-HMA explanation are tested. Production import approval remains an authenticated workflow gate. |
| Specialty populations | Locally verified | Early specialty plus ordinary-turn overlap is permitted and duplicate ordinary/specialty stages are otherwise rejected. |
| A-Day constraints | Locally verified | Nullable non-policy caps and explicit specialty constraints are modeled. Production Mock acceptance remains required. |
| Operators/permissions | Needs operator confirmation | Exact production action grants must be confirmed in the saved successor. |
| Operating settings | Needs operator confirmation | Effective date is intentionally unset until an administrator confirms it. |
| Mock rehearsal | Not yet accepted | Must run from the exact production successor with Portal/staffing writeback disabled. |
| Live readiness | Blocking until Mock acceptance | May turn green only after authenticated production-shape workflows and the production Mock pass. Real start remains a separate explicit administrator action. |

The readiness UI must report these named categories with direct recovery actions.
It must not revive the resolved 242-versus-228 or population-size comparisons as
vague blockers.
