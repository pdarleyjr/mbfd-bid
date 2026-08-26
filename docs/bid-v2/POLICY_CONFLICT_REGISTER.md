# MBFD Bid v2 policy conflict register

| ID | Conflict or open question | Evidence | Required disposition |
| --- | --- | --- | --- |
| POL-001 | Excluded Union President identifier differs | External 2026 policy identifies `A711`; fixture/seed uses `A701`. | Policy-owner confirmation and data correction plan. |
| POL-002 | Position topology/counts differ | Policy template versus seeded A/B/C/D distributions and station counts. | Reconcile source topology; do not derive capacity from occupancy. |
| POL-003 | Credential/rule documentation drift | README counts differ from committed credential/rule fixtures. | Correct documentation after source review. |
| POL-004 | DE and Lieutenant Rescue eligibility defaults conflict with broad policy wording | Default generated rules omit requirements in documented cases. | Do not activate defaults until verified rule-by-rule. |
| POL-005 | Rescue Float Pool rules | Source explicitly calls for administrator clarification. | Block dependent behavior. |
| POL-006 | Firefighter specialty scope | Directive names this an initial blocker. | Policy-owner resolution. |
| POL-007 | Marine scoring weights and ties | Directive names values/tie-break as unresolved. | Policy-owner resolution. |
| POL-008 | Special Ops tie-break and Division Chief handling | Directive names unresolved. | Policy-owner resolution. |
| POL-009 | Days term/cycle, D-shift scope, and A-Day capacity/officer rules | Directive names unresolved. | Policy-owner resolution. |
| POL-010 | Certification evaluation date and specialty interruption decline/recall | Directive names unresolved. | Policy-owner resolution. |
| POL-011 | Mid-cycle vacancy authorization details | Directive names unresolved. | Policy-owner resolution. |
| POL-012 | Policy references AI behavior while runtime retires it | 2026 policy content and current source differ. | Update policy or explicitly define the optional non-mutating replacement boundary. |

No item above may be resolved by an implementation assumption.
