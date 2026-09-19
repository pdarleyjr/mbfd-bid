# Final 2026 policy coverage matrix

Review date: 2026-09-19. This is a sanitized implementation and source review of
the working candidate, not a completion certificate. It contains no personnel
identities, credential holdings, relationship facts or production mutations.

The source authority and hashes are recorded in
[the source manifest](final-2026-source-manifest.json). The PDF governs policy
semantics; workbook numeric weights are reusable only where consistent with it.
The user's Marine clarification is separate authority: **only minimum-qualified
personnel may be forced**. No general precedence rule is inferred from that
clarification for Air Tech or other roles.

## Evidence classes

| Class | Meaning at this review |
| --- | --- |
| Implemented mechanism | Code exists in the local working candidate. This does not establish final-source configuration or release. |
| Source proposal | Private source extraction/configuration material identifies requirements and candidate memberships. It has not established a saved, approved, complete final configuration. |
| Synthetic verification | Local tests exercise invented members, seats and evidence. Passing tests do not prove real personnel facts, production state, external delivery or source ambiguity resolution. |
| Live proof | No final-source production installation, Real Bid creation/start, actual award, personnel mutation or production browser acceptance is established by this matrix. |

The private source proposal covers 228 organizational positions and four closed
2026 Days opportunities, explicit profile memberships and exact catalog-name
matches. Unresolved bindings and equivalences remain unresolved fields, rather
than guessed IDs, dates, members or zero-valued preference weights. The public
matrix deliberately does not reproduce that private material.

## Policy-to-implementation coverage

File paths below are repository relative. Tests listed establish bounded
mechanism coverage; the final configuration and Live proof columns remain
separate for every row.

| Requirement and source anchor | Implemented mechanism / evidence | Final-source configuration and outstanding behavior |
| --- | --- | --- |
| Annual scope, exclusions and at least 12-month tour; PDF p1 Policy/Scope/Duration | Versioned Bid definitions, explicit participation, pinned run preparation and canonical completion; `bid-definition-run.ts`, `official-annual-completion.ts`. | Final dates, participant coverage, excluded opportunities and complete source-certified configuration still require review. Session UI duration is not proof of the personnel assignment term. |
| Days terms, prior service, protected occupancy, three consecutive cycles; PDF p1 Procedure1 footnote1 and p2 footnote2 | `assignment-terms.ts` separately evaluates accumulated service, protection and reopening cycles. Migration0063 and `tenure-evidence.ts` add reviewed member/service/cycle evidence. Authoring and history UI preserve historical absence. Unit and integration term/evidence tests exist; four tenure UI tests pass. | Source facts, approved staffing bindings and incumbents are required. Frozen voluntary-only participation, explicit departure election checks for changed awards, accepted event/receipt verification and canonical Department transition are now implemented and locally tested. Consent is an operator-recorded member-confirmation attestation with an evidence reference, not an independently authenticated member action. Service completion does not erase protection against bumping. The no-closure source-assignment race is corrected and covered by before-batch status, seat and end-date drift tests. |
| General ordered fallback; PDF p1 Procedure2 | `bid-fallback.ts` computes eligible candidates, comparator order and tier exhaustion from frozen rules and durable responses. Canonical service rejects wrong tier/mode/candidate; explicit empty policies prohibit unconfigured generic forcing. Optional absence preserves historical snapshots. `BidFallbackFields.tsx` authors source-bound tiers. | Exact role-specific tiers, training/certification predicates, current-assignment facts and source-certified seniority comparators remain configuration work. The generic engine does not itself decide which role may relax normal minima. |
| Prevention and Events Captain/Lieutenant; PDF pp1-2 Procedure3(a-d) | Existing required-credential rules, alternative qualifications and grouped scoring compile through `annual-rule-compiler.ts`; shared profiles edit concrete rules. | Current FL qualification evidence and exact catalog mappings remain necessary. Events Captain NFPA1123, NFPA1126, RN8312 and RN8313 weights are not completely supplied by a trustworthy distinct oracle profile. Prevention Lieutenant RN8977 combined-course preference has no reliable distinct weight. Do not reuse the old inspector-only Events Captain table as final parity. |
| Investigator FF: State Fire Investigator AND FL Fire Inspector, IAAI-CFI preference tier, conditional secondary scoring, current-assignee fallback; PDF p2 Procedure3(e) | Golden tests enforce both mandatory certificates. Reusable grouped scoring and ordered fallback support the separate concepts; optional points cannot compensate for a missing minimum. | IAAI-CFI-first and non-IAAI-CFI secondary weights/tier configuration must be reviewed explicitly. Final MASTER labels A305/B305/C305 as Combat3 while PDF requires Ladder3; actual staffing binding must establish the exception. Tests of the minimum are not proof of the complete preference/assignment workflow. |
| Training Lieutenant closed in 2026; future Instructor minimum and gated preferences; PDF p2 Procedure4(a), footnote2 | Explicit participation/terms can retain organizational positions while closing Bid opportunities. Golden tests cover all-six-Operations gating used by the scoring primitive. | Source closures include D401 and D402. Future opening still needs current Instructor evidence and reviewed term/credential facts. Outdated workbook column references and ungated technician totals are intentional oracle divergences. |
| Support Services Days Captain closed in 2026; PDF p2 Procedure5 | Same explicit opportunity closure and term mechanisms. | D301 closure is identified in the proposal. It is not deletion of an enabled organizational seat, and not evidence that a final configuration was published. |
| Rescue Days Captain closed in 2026; Captain, Paramedic and 36 cumulative Rescue Division1220 months when open; PDF p3 Procedure6(a) | Credential AND rules and cumulative service evaluation are reusable; term closure and current-assignee fallback are explicit mechanisms. | D201 closure is identified. Actual division service facts and exact certificate validity remain required for any future opening. Full Rescue Days preference configuration is not established by Captain5 tests. |
| Captain5: Captain + current FL Paramedic + 36 cumulative Division1220 months; five preference categories; PDF p3 Procedure6(b) | Golden tests cover rank, Paramedic, service threshold, partial service and the five one-point categories, with each alternative credited once. | Real service/certificate evidence, exact catalog alternatives and the explicit source-to-seat scope remain required. No general Paramedic catalog label proves current FL status by itself. |
| Station2 Special Operations; PDF p4 Procedure7 | Golden tests exercise six one-point Operations credentials, technician points only after all six prerequisites, and independent Part107. Maximum optional total13; DE variants keep required-DE constants separate. | Final profile overlap/precedence for Station2 and dedicated Captain5/AirTech/DE/DC roles must be explicit. Do not accidentally add a generic station total twice. |
| Main Air Tech FF/DE: Scott SCBA AND Cylinder Hazmat/FSO AND DE; car-seat preference; backup Air Tech preferences; PDF p4 Procedure7(a),(ii) | Golden tests reject either missing main certificate and missing DE, keep car-seat optional, and enforce six-Operations gates. Shared alternatives/weights exist. | Main and backup are distinct profiles. Backup preference weights are unresolved. Air Tech force interpretation remains pending because the minimum-qualified reverse pathway and Procedure2 cross-reference cannot be silently reconciled. |
| Marine role minima; PDF pp4-6 Procedure8(a-e) | Golden tests cover valid-role rank shape, MMC/OUPV semantic requirement, IADRS, Open Water, Awareness, role-specific MetalCraft, and DE additionally for Operator/Engineer. Minimum eligibility precedes preferences. | Tests use synthetic source-semantic credentials. Actual catalog equivalences, validity and passing-test evidence remain unresolved in part; current Chief supplemental requirements were not located. No generic alias proves MMC/OUPV, IADRS passing status, DRI/PADI provider or current validity. |
| Marine preferences and force; PDF pp5-6 Procedure8 plus user clarification2026-09-19 | Optional PSD and FF car-seat scoring is separated from minima; canonical changed awards are eligibility-checked, including force. Fallback MINIMUM_QUALIFIED supports the user's resolved restriction. | Every final Marine fallback tier must retain all minimum requirements. Generic EXPLICIT_REQUIREMENTS exists for other source-authorized cases and is not authority to weaken Marine minima. Marine force ambiguity is resolved by the user; supplemental requirements and mappings remain separate gaps. |
| Marine post-award obligations; PDF p6 Procedure8(f)(i-iii), footnote3 | Existing `post-award-obligations.ts` and rule post-award requirements represent dated obligations and reviewed follow-up; authoring preserves optional fields. | Final Open-Water-only DRI PSD obligation needs an approved bid-start date and three-calendar-month deadline. PADI-to-DRI continuing education/training/renewal must not receive an invented deadline. Full deadline monitoring, reviewed loss/reassignment consequences and real-member acceptance are not verified here. |
| Marine A-Day: four core roles all distinct, total core plus floats at most2/group; PDF p6 Procedure8(f)(iv-v) | `frozen-a-day.ts` with explicit position/member/rank scopes and the existing A-Day engine. Tests enforce core max1 separately from combined max2, and rebuild amendments before persistence. | Final core/floats scopes must be populated from reviewed source bindings. Generic `specialtyMaximums` alone is not the installed execution scope. Daily boat tasks, qualified vacation/overtime coverage and operational staffing are not demonstrated by these Bid allocation tests. |
| SWAT: six medics, two/shift, separate groups, not rank/unit-specific; PDF pp6-7 Procedure9 | `bid-membership-distribution.ts` supports reviewed existing member overlays without extra seats. Canonical integration checks maxima, membership completeness and final per-shift minima. Authoring tests cover explicit members/shifts/limits, blank sources and saved missing references. | Whether only the current six are distributed or additional qualified volunteers may bid remains unresolved. A fixed-membership primitive cannot resolve this policy interpretation. Final training/deployability and membership facts require authority; no identities are inferred from credentials or labels. |
| Light-duty Days availability; PDF p7 Procedure10 | Explicit participation and availability can remove a Bid opportunity while retaining the organization seat. | Final affected positions require authorized, effective-dated facts. Case-by-case long-term decisions and the complete live availability path have not been verified in this bounded review. |
| Combat/Rescue floats and specialty exceptions; PDF p7 Procedure11 | `bid-opportunity-pool.ts` models explicit capacity pools separate from daily unit assignment; validates equivalent selection rules, stage/policy scopes and concrete reservation order. | Final Combat/Rescue pool membership, Paramedic/specialty minima and exceptions need configuration. Daily Chief placement must not be inferred as a permanent station assignment. Complete Department transition semantics remain under active work. |
| Eight FF/DE positions, DE credential, reverse qualified fallback, max2/group; PDF p7 Procedure12 | Mandatory credentials, ordered qualified fallback and scoped A-Day max2 are reusable and tested independently. | Whether the DE group cap includes Marine Operator/Engineer and Air Tech is unresolved. Final scope must be explicit; neither all firefighters nor everyone possessing DE is an authorized substitute. |
| Station1/3 station-level FF/DE pools, Investigator exception; PDF p7 Procedure13(a-d) | Explicit station pools retain concrete capacity while ignoring daily apparatus labels; validate equal rules and reservation order. Canonical changed-award gate is under concurrent review. | Source memberships and verified staffing bindings are required. Investigator stays a dedicated exception; do not include its seat in an interchangeable ordinary pool. Daily unit selection and final Department transition require separate acceptance. |
| Simultaneous A-Day, specialized-shift exceptions; PDF p7 Procedure14 | Same pure allocation engine used during canonical award, amendment and completion; selection-time upper bounds and completion-time minima; optional exact officers/group; omitted historical execution remains readable. Synthetic canonical tests pass. | Specialized Shift Positions Timeline is missing in searched scope. Final timing exceptions and any exact officer-count value require authority; no default exact count is assumed. Shift Chief holiday-leave exception is not proven by Bid allocation tests. |
| Relationship separate-shift rule; PDF p8 Procedure15 and supporting SOG200.17 | Supporting SOG located with separate provenance; generic restrictions may supply facts only when authorized. | Full canonical relationship-constraint coverage was not established in this review. Real relationship facts must never be inferred or included in public artifacts. Source missingness is resolved; behavior/data verification remains separate. |
| Disputes and retained authority; PDF p8 Procedure16 | Existing reviewed-source decisions and audit evidence record explicit authority. | Labor/Management-first and Chief-final decision procedure must remain human-reviewed. Missing Article5 does not block ordinary deterministic picks by itself; it blocks inventing additional automated override powers. |
| Contact, preferences, deferral/return and union presence; PDF p8 Bid Selection1-3 | Frozen preference-sheet selection validation; contact history, configurable timing, unresolved-member state and return-at-current-sequence mechanisms. Decline/unreachable response evidence enforced. Canonical persistence tests verify target-member latest-contact update and replay. | PDF supplies no numeric minimum attempts or wait duration. An invented count is not a source requirement. End-of-day deferral semantics, union presence and external Teams/phone/TargetSolutions procedures require operational acceptance beyond contact-unit tests. |
| Captain/Lieutenant/Firefighter order; FF Department seniority, other ranks time in grade; PDF p8 Bid Selection4-5, footnote4 | Version2 per-stage ordering authority, resolved source-decision binding, missing/tied facts fail closed; historical version1 retained. `contextual-bid-ordering.test.ts` covers contextual directions. | Source-to-domain mapping remains pending. Calculation Rank Seniority/Straight Seniority names do not prove equivalence to stored rank_seniority/rsc_seniority. Master RscSeniorityIn differs; no promotion dates or identity tie-breaks may be invented. |
| Daily results and publication; PDF p8 Bid Selection6 | Canonical result read model, completion evidence and History/audit filters; results use canonical awards without mixing legacy records or creating runs. | Real email delivery and TargetSolutions bulletin publication are not implemented/verified by a readable result screen. No external message delivery or full browser acceptance is claimed. |
| Annual vacancies and transfers; PDF pp8-9 Filling Vacancies1-3 | Existing effective-dated staffing/transition infrastructure now consumes official canonical awards directly, with frozen transition permission and guarded future assignment writes; local canonical transition tests pass. | Full within-shift vacancy advertising/windows, qualified seniority, transfer/promotion/school remainder-of-year rules and Days voluntary/forced vacancy tiers need their own configuration and end-to-end acceptance. Annual fallback tests do not prove vacancy policy parity. |
| MASTER topology; Positions!A1:I229 | Source review verified228 distinct enabled organization slots: A74/B73/C73/D8. Authoring separates topology, opportunity participation and reviewed staffing bindings. | Source number reuse creates identity conflicts. Existing A102 is FF/DE on Ladder1; final row3 A102 is Lieutenant/Combat1. No old assignment, term, staffing binding or rule may be inherited only because the number matches. All final bindings require an explicit reviewed crosswalk. |

## Platform boundary coverage

| Boundary | Implemented and tested behavior | Remaining acceptance |
| --- | --- | --- |
| Rule profiles and source review | Profile authoring uses the shared compiler; save compiles concrete rules, and review previews impact without creating a version or run. Source decisions retain explicit resolutions and provenance. | Review all final profile-to-position memberships, conflict resolutions, overlap precedence, exact credential semantics and missing weights. A source review report is not an installed configuration. |
| Managed Live preflight and creation | `BidLiveReview.tsx`, `CurrentBidWorkspace.tsx`, `bid-client.ts` and tests enforce read-only review, explicit create confirmation, exact version/context/source pins, dirty/stale/locked denial and response identity checks. Durable pending requests retain the same idempotency key on refresh; definitive conflicts invalidate review/confirmation, uncertain outcomes preserve pending identity. | Real browser acceptance against the release candidate is separate. Creation does not start a Bid; neither action is proven live here. |
| Frozen execution and receipts | Canonical service validates source/version integrity, derives fallback order, checks changed awards and allocation before atomic persistence, rejects stale sequence/key reuse and returns stored receipts on exact retry. Contact tests establish no duplicate event on retry. | Exact release regression, restart/recovery rehearsal and production migration compatibility must pass. No test licenses rewriting historical snapshot meaning. |
| Historical compatibility | Optional fallback/A-Day/membership/term absence remains distinct from an explicit empty configuration. Version1 ordering authority remains readable. Existing term history can lack the three new facts. | Compatibility is bounded by tested snapshots; full historical production-read acceptance is not certified by this matrix. |
| Department application and official results | Result reads consume canonical awards and official completion evidence. Staffing binding/term evidence remains separately reviewed. | Canonical annual-award transition and departure protection now have local implementation and passing focused tests. The independently identified no-closure source-assignment race is corrected and locally regression-tested. A displayed award is not proof that Department staffing was applied. |

## Unresolved authority and narrow blocking scope

| Gap | Required next evidence | Affected behavior |
| --- | --- | --- |
| Seniority source mapping | Authorized interpretation and identity-safe reconciliation of the two final workbook channels to Department/time-in-grade domains; reject missing, duplicated and tied facts. | Ordinary and reverse ordering using those domains; no guessed personnel update. |
| Air Tech force interpretation | Explicit resolution of its minimum-qualified pathway versus Procedure2. | Air Tech fallback eligibility/tier configuration; main normal minimum tests remain valid. |
| DE A-Day scope | Explicit inclusion/exclusion of specialty DE assignments. | Final DE max2 enforcement scope; generic scoped limits already work. |
| SWAT membership model | Whether existing six only or additional qualified applicants may bid, plus approved member/training/deployability facts. | SWAT participant selection, distribution and any membership transition. |
| Missing Timeline | Effective Specialized Shift Positions Timeline or explicit authorized timing exception configuration. | Specialized-shift A-Day timing exceptions; ordinary simultaneous mechanism can be tested independently. |
| Missing Chief supplemental requirements | Effective Special Operations/Marine requirements or authoritative confirmation that PDF minima are exhaustive. | Complete final Marine admission/assignment qualification; unrelated roles proceed independently. |
| Missing Article5 | Actual incorporated text before adding discretionary powers. | Additional automated override/dispute authority only; not all deterministic selection. |
| Credential qualifiers and preference weights | Exact evidence for validity, provider, passing status and equivalences; approved distinct weights where absent. | Affected member eligibility/ranking. Unresolved categories are neither zero-weight defaults nor catalog-name guesses. |
| Topology identity and staffing binding | Reviewed final-source-to-authorized-seat crosswalk, including rank/unit changes and the Investigator exception. | Final topology installation, incumbency/term evaluation and Department application for affected seats. |

The expanded search scope and supporting-source provenance are in
[the external reference register](final-2026-external-references.md). Absence is
limited to that searched scope, not every possible remote system or filesystem.

## Executed evidence and remaining release gates

On 2026-09-19 this reviewer ran a focused worker batch covering final-policy golden
rules, frozen A-Day, contextual ordering, fallback, opportunity pools, assignment
terms and membership distribution, including canonical A-Day/membership tests:
**9 files, 137 tests passed**. These are synthetic fixtures, not final data imports.

Separately, after the contact projection correction, canonical fallback tests
passed **13 cases**, with 11 intentional unsupported-mode skips. Current Bid field
tests passed **44 cases**, including three new membership authoring cases. Four
tenure UI tests and the web typecheck passed. These results describe the tested
working state; concurrent edits and subsequent commits require release validation
against their exact candidate revision.

The source golden fixtures explicitly correct workbook mistakes: all-six
Operations prerequisites, main Air Tech certificate AND, Captain5 Paramedic and
36-month service, role-specific Marine minima and Investigator's two required
certificates. They are not a complete final-policy acceptance suite or proof of
every preference, operational exception or transition.

Before calling the final policy complete, independently establish: resolved
source decisions and missing evidence; reviewed personnel/catalog/topology
mapping; saved final configuration with explicit scopes and closures; real operator/member acceptance; full exact-revision tests;
browser workflow acceptance; migration and recovery rehearsal; immutable release
identity; bounded live readback. Real Bid creation, start, awards and external
delivery remain distinct actions and evidence gates.

## Independent term and transition review update

Reviewed on 2026-09-19 after the initial matrix: optional frozen term participation
binds the source assignment, staffing position, term/evidence revision and date;
each changed voluntary award requires explicit confirmation and evidence. Forced
awards reject those rights and forced fallback tiers exclude the member. A fresh
amendment needs fresh election input. Official completion validates the election
against its accepted canonical command event and receipt. Exact command retry
returns the original receipt rather than inventing a new election.

Department transition consumes canonical fills whenever canonical state exists,
uses legacy awards only for historical sessions without that state, requires the
frozen approve-transition grant, rechecks the source assignment, and writes future
closures/replacements with a final transaction guard. Local tests cover apply,
replay, source drift before preview, historical ordinary canonical awards and
rollback. This reviewer reran four relevant suites: **38 tests passed**.

The independently identified no-closure race is corrected: every frozen term
source is now checked in the final atomic guard, even when its finite end date
precedes the requested future transition and the planner needs no closure.
Focused regression tests inject a committed source status, staffing-position or
end-date change after context loading and immediately before the real batch.
Each rejects with no transition assignment, lifecycle or audit writes while
preserving the concurrent edit. An unchanged finite source transitions successfully.
The updated term suite passed 16/16, existing transition suites passed 13/13,
and worker typecheck passed. These are local synthetic checks.

The local mechanism does not establish deployment, real member acceptance or
independent member authentication. Recorded consent remains an authorized
operator's explicit attestation and evidence pointer. No automatic reopening or
backfill of the protected source opportunity is introduced.
