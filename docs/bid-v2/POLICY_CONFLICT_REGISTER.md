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
| POL-013 | Technician point gating was serialized but not enforced | The source rule document requires all six Operations credentials for any Technician points; fixtures use `gating: "ops_all_6"`, while the runtime previously read only `requiresOpsPair`. | Local typed decoder now maps the marker to an explicit all-operations gate at Worker HTTP evaluation/mutation and publication boundaries. Member eligibility is bound to the active book matching its session year, and draft mutation revision prevents a stale validation pass from publishing a changed book. The current DO pick path is not covered; verify every authoritative policy row before release. |
| POL-014 | Source credential literals contain outer whitespace that makes exact matching unsatisfiable | `IADRS Swim Evaluation ` and `State of Florida Live Fire Training Instructor I ` differ from the credential catalog only by surrounding whitespace. | Local decoder normalizes only outer whitespace; no aliases were invented. Verify every authoritative policy row before release. |
| POL-015 | `pre_bid_pool` has no implemented semantic model | Three fixture rules use the custom criterion; the evaluator previously ignored unknown customs. | Local decoder rejects those rules at Worker HTTP publication and evaluation/mutation boundaries until policy owners approve and implement their semantics. Existing source conflict remains unresolved. |
| POL-016 | Rule-book completeness has no authorized expected-position coverage contract | Source topology remains conflicted, and the schema does not identify a single authoritative position set per rule book. | Publication now rejects empty and duplicate books but cannot prove complete coverage; reconcile source topology before release. |

No item above may be resolved by an implementation assumption.
